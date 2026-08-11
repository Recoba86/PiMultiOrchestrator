import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

/** A deliberately small OpenAI-compatible fixture for offline M2 tests. */
export interface FakeModel {
	readonly id: string;
	readonly object?: string;
	readonly name?: string;
	readonly owned_by?: string;
	readonly context_window?: number;
	readonly max_tokens?: number;
	readonly [key: string]: unknown;
}

export type ModelsMode =
	| "valid"
	| "add"
	| "remove"
	| "duplicate"
	| "malformed"
	| "oversized"
	| "unauthorized"
	| "error"
	| "slow";

export interface FakeNineRouterOptions {
	readonly token?: string;
	readonly models?: readonly FakeModel[];
	readonly modelsMode?: ModelsMode;
	readonly delayMs?: number;
	readonly completionText?: string;
}

export interface FakeRequestObservation {
	readonly method: string;
	readonly path: string;
	readonly authAccepted: boolean;
	readonly model?: string;
	readonly stream?: boolean;
	readonly includeUsage?: boolean;
	readonly messageCount?: number;
}

const DEFAULT_TOKEN = "m2-fake-token";
const DEFAULT_COMPLETION = "PI_FAKE_9ROUTER_OK";

/**
 * Keep the 36-entry fixture deterministic. IDs intentionally contain a slash,
 * exercising Pi's provider/model split without changing the exact remote ID.
 */
export function makeCatalogModels(count = 36): FakeModel[] {
	return Array.from({ length: count }, (_, index) => {
		const number = String(index + 1).padStart(2, "0");
		return {
			id: `fake/model-${number}`,
			object: "model",
			name: `Fake Model ${number}`,
			owned_by: "fake-9router",
			context_window: 128_000,
			max_tokens: 4_096,
		};
	});
}

export function makeSameFamilyModels(): FakeModel[] {
	return [
		{
			id: "fake/family-a",
			object: "model",
			name: "Same Family",
			owned_by: "fake-resource-a",
		},
		{
			id: "fake/family-b",
			object: "model",
			name: "Same Family",
			owned_by: "fake-resource-b",
		},
	];
}

function json(res: ServerResponse, status: number, value: unknown): void {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
	// The body is intentionally generic: credentials and request headers never
	// enter fixture output, making leak assertions meaningful.
	json(res, status, { error: { type: "fixture_error", message } });
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buffer.length;
		if (size > maxBytes) throw new Error("request-too-large");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function modelList(mode: ModelsMode, source: readonly FakeModel[]): FakeModel[] {
	const models = [...source];
	if (mode === "add") {
		models.push({
			id: "fake/model-37",
			object: "model",
			name: "New Fake Model 37",
			owned_by: "fake-9router",
		});
	}
	if (mode === "remove") models.splice(0, 1);
	if (mode === "duplicate" && models[0]) models.push({ ...models[0] });
	return models;
}

export class FakeNineRouter {
	readonly token: string;
	readonly server: Server;
	readonly observations: FakeRequestObservation[] = [];
	private readonly sockets = new Set<Socket>();
	private models: FakeModel[];
	private mode: ModelsMode;
	private readonly delayMs: number;
	private readonly completionText: string;
	private portNumber: number | undefined;

	constructor(options: FakeNineRouterOptions = {}) {
		this.token = options.token ?? DEFAULT_TOKEN;
		this.models = [...(options.models ?? makeCatalogModels())];
		this.mode = options.modelsMode ?? "valid";
		this.delayMs = options.delayMs ?? 250;
		this.completionText = options.completionText ?? DEFAULT_COMPLETION;
		this.server = createServer((req, res) => {
			void this.handle(req, res);
		});
		this.server.on("connection", (socket) => {
			this.sockets.add(socket);
			socket.once("close", () => this.sockets.delete(socket));
		});
	}

	get port(): number {
		if (this.portNumber === undefined) throw new Error("FakeNineRouter has not started");
		return this.portNumber;
	}

	get baseUrl(): string {
		return `http://127.0.0.1:${this.port}/v1`;
	}

	get modelsRequests(): FakeRequestObservation[] {
		return this.observations.filter((request) => request.method === "GET" && request.path.endsWith("/models"));
	}

	get chatRequests(): FakeRequestObservation[] {
		return this.observations.filter((request) => request.method === "POST" && request.path.endsWith("/chat/completions"));
	}

	setModelsMode(mode: ModelsMode): void {
		this.mode = mode;
	}

	setModels(models: readonly FakeModel[]): void {
		this.models = [...models];
	}

	async start(): Promise<void> {
		if (this.portNumber !== undefined) return;
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error): void => {
				this.server.off("listening", onListening);
				reject(error);
			};
			const onListening = (): void => {
				this.server.off("error", onError);
				const address = this.server.address();
				if (!address || typeof address === "string") {
					reject(new Error("FakeNineRouter did not receive a TCP address"));
					return;
				}
				this.portNumber = address.port;
				resolve();
			};
			this.server.once("error", onError);
			this.server.once("listening", onListening);
			this.server.listen(0, "127.0.0.1");
		});
	}

	async close(): Promise<void> {
		if (this.portNumber === undefined) return;
		for (const socket of this.sockets) socket.destroy();
		await new Promise<void>((resolve, reject) => {
			this.server.close((error) => (error ? reject(error) : resolve()));
		});
		this.portNumber = undefined;
	}

	private authorized(req: IncomingMessage): boolean {
		return req.headers.authorization === `Bearer ${this.token}`;
	}

	private record(
		req: IncomingMessage,
		extra: Omit<FakeRequestObservation, "method" | "path" | "authAccepted"> = {},
	): void {
		this.observations.push({
			method: req.method ?? "UNKNOWN",
			path: new URL(req.url ?? "/", this.baseUrl).pathname,
			authAccepted: this.authorized(req),
			...extra,
		});
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const path = new URL(req.url ?? "/", this.baseUrl).pathname;
		if (req.method === "GET" && (path === "/v1/models" || path === "/models")) {
			this.record(req);
			await this.handleModels(req, res);
			return;
		}
		if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/chat/completions")) {
			await this.handleChat(req, res);
			return;
		}
		sendError(res, 404, "fixture-route-not-found");
	}

	private async handleModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (!this.authorized(req) || this.mode === "unauthorized") {
			sendError(res, 401, "fixture-auth-required");
			return;
		}
		if (this.mode === "slow") await wait(this.delayMs);
		if (this.mode === "error") {
			sendError(res, 500, "fixture-models-failure");
			return;
		}
		if (this.mode === "malformed") {
			json(res, 200, { object: "list", models: "not-an-array" });
			return;
		}
		if (this.mode === "oversized") {
			const body = `${JSON.stringify({ data: modelList("valid", this.models) })}${"x".repeat(2 * 1024 * 1024)}`;
			res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
			res.end(body);
			return;
		}
		json(res, 200, { object: "list", data: modelList(this.mode, this.models) });
	}

	private async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
		let body: Record<string, unknown>;
		try {
			body = JSON.parse(await readBody(req)) as Record<string, unknown>;
		} catch {
			sendError(res, 400, "fixture-invalid-json");
			return;
		}
		const messages = Array.isArray(body.messages) ? body.messages : undefined;
		const observation = {
			stream: body.stream === true,
			includeUsage:
				typeof body.stream_options === "object" && body.stream_options !== null
					? (body.stream_options as { include_usage?: unknown }).include_usage === true
					: false,
			...(typeof body.model === "string" ? { model: body.model } : {}),
			...(messages ? { messageCount: messages.length } : {}),
		};
		this.record(req, observation);
		if (!this.authorized(req)) {
			sendError(res, 401, "fixture-auth-required");
			return;
		}
		const model = typeof body.model === "string" ? body.model : "unknown-model";
		if (body.stream !== true) {
			json(res, 200, {
				id: "fake-completion",
				object: "chat.completion",
				model,
				choices: [{ index: 0, message: { role: "assistant", content: this.completionText }, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
			return;
		}
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		const chunks = [
			{
				id: "fake-completion",
				object: "chat.completion.chunk",
				model,
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			},
			{
				id: "fake-completion",
				object: "chat.completion.chunk",
				model,
				choices: [{ index: 0, delta: { content: this.completionText }, finish_reason: null }],
			},
			{
				id: "fake-completion",
				object: "chat.completion.chunk",
				model,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			},
		];
		for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
		res.end("data: [DONE]\n\n");
	}
}
