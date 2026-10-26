// Cloudflare Pages Function: https://<project>.pages.dev/v1/* → API_ORIGIN/v1/* (ADR-0011).
import { proxyRequest, type ProxyEnv } from '../../src/proxy/apiProxy';

export const onRequest = (context: { request: Request; env: ProxyEnv }): Promise<Response> =>
  proxyRequest(context.request, context.env);
