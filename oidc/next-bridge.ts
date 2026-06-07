import { EventEmitter } from "node:events";
import { ServerResponse, type IncomingMessage } from "node:http";
import { parse as parseQueryString } from "node:querystring";
import httpMocks from "node-mocks-http";
import type { Body, RequestMethod } from "node-mocks-http";

type MockRequest = IncomingMessage & {
  originalUrl?: string;
  baseUrl?: string;
};

function stripPrefix(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) return pathname;
  const stripped = pathname.slice(prefix.length);
  return stripped || "/";
}

function headerObject(headers: Headers, url: URL) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });

  output["x-forwarded-proto"] ??= url.protocol.replace(":", "");
  output["x-forwarded-host"] ??= url.host;

  return output;
}

function parseBody(contentType: string | null, body: Buffer | null): Body | undefined {
  if (!body || body.length === 0) return undefined;

  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return parseQueryString(body.toString("utf8"));
  }

  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  }

  return { rawBody: body };
}

export async function runWithNodeBridge(
  request: Request,
  prefix: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
) {
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? null : Buffer.from(await request.arrayBuffer());
  const relativeUrl = `${stripPrefix(url.pathname, prefix)}${url.search}`;
  const req = httpMocks.createRequest<MockRequest>({
    method: request.method as RequestMethod,
    url: relativeUrl,
    originalUrl: `${url.pathname}${url.search}`,
    headers: headerObject(request.headers, url),
    body: parseBody(request.headers.get("content-type"), body),
  });
  req.baseUrl = prefix;
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];

  res.write = ((chunk: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  }) as typeof res.write;

  res.end = ((chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    res.emit("finish");
    res.emit("end");
    return res;
  }) as typeof res.end;

  const finished = new Promise<void>((resolve) => {
    res.on("end", resolve);
    res.on("finish", resolve);
  });

  if (body) {
    req.once("async_iterator", () => {
      req.emit("data", body);
      req.emit("end");
    });
  }

  await handler(req, res);
  await finished;

  const headers = new Headers();
  for (const [name, value] of Object.entries(res.getHeaders())) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, String(item));
    } else {
      headers.set(name, String(value));
    }
  }

  const responseBody = Buffer.concat(chunks);

  return new Response(responseBody, {
    status: res.statusCode,
    headers,
  });
}
