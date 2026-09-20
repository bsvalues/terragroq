import { describe, expect, it } from "vitest"

import {
  buildHelloProxyUpstreamHeaders,
  HELLO_HTTPS_PORT,
  HELLO_UPSTREAM_PORT,
} from "@/scripts/hello-application/hello-https-proxy.mjs"
import * as helloHttpsProxy from "@/scripts/hello-application/hello-https-proxy.mjs"
import {
  childBaseEnvironment,
  parseHelloRuntimeEnvironment,
  validateHelloSourceIdentity,
} from "@/scripts/hello-application/start-williamos-hello-runtime.mjs"

describe("isolated HERMES Hello runtime contract", () => {
  it("preserves Docker plugin discovery without inheriting runtime secrets", () => {
    const childEnvironment = childBaseEnvironment({
      PATH: "C:/Program Files/Docker/Docker/resources/bin",
      ProgramFiles: "C:/Program Files",
      ProgramW6432: "C:/Program Files",
      DATABASE_URL: "postgresql://must-not-leak",
      WILLIAMOS_TERRAFUSION_ROOT: "C:/forbidden",
    })

    expect(childEnvironment).toMatchObject({
      PATH: "C:/Program Files/Docker/Docker/resources/bin",
      ProgramFiles: "C:/Program Files",
      ProgramW6432: "C:/Program Files",
    })
    expect(childEnvironment.DATABASE_URL).toBeUndefined()
    expect(Object.keys(childEnvironment).some((key) => key.includes("TERRAFUSION"))).toBe(false)
  })

  it("accepts only the explicit WilliamOS auth/database secret allowlist and injects the Hello identity", () => {
    const parsed = parseHelloRuntimeEnvironment([
      "DATABASE_URL=postgresql://owner:secret@atlas:15432/williamos",
      "BETTER_AUTH_SECRET=secret-value",
      "WILLIAMOS_OWNER_EMAIL=owner@example.test",
      "",
    ].join("\n"), {
      sourceRoot: "C:/HermesLab/WilliamOS-Disposable/hello/source",
      canonicalOrigin: "https://williamos.lan:3543",
      hermesRuntimeRoot: "C:/Users/bs/.williamos/hermes-bridge",
    })

    expect(parsed).toMatchObject({
      WILLIAMOS_PROJECT_ROOT: "C:/HermesLab/WilliamOS-Disposable/hello/source",
      WILLIAMOS_DEFAULT_PROJECT: "hello-application",
      WILLIAMOS_VISIBLE_PROJECTS: "hello-application,williamos",
      WILLIAMOS_HELLO_ENABLED: "1",
      BETTER_AUTH_URL: "https://williamos.lan:3543",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://williamos.lan:3543",
    })
    expect(Object.keys(parsed).some((key) => key.includes("TERRAFUSION"))).toBe(false)
  })

  it("fails closed on TerraFusion, unknown, duplicate, or multiline environment entries", () => {
    const options = {
      sourceRoot: "C:/source",
      canonicalOrigin: "https://williamos.lan:3543",
      hermesRuntimeRoot: "C:/bridge",
    }
    expect(() => parseHelloRuntimeEnvironment("WILLIAMOS_TERRAFUSION_ROOT=C:/forbidden\n", options)).toThrow("HELLO_RUNTIME_TERRAFUSION_ENV_REFUSED")
    expect(() => parseHelloRuntimeEnvironment("UNREVIEWED_KEY=value\n", options)).toThrow("HELLO_RUNTIME_ENV_KEY_REFUSED")
    expect(() => parseHelloRuntimeEnvironment("DATABASE_URL=one\nDATABASE_URL=two\n", options)).toThrow("HELLO_RUNTIME_ENV_DUPLICATE")
    expect(() => parseHelloRuntimeEnvironment("DATABASE_URL=one\rhidden\n", options)).toThrow("HELLO_RUNTIME_ENV_INVALID")
  })

  it("recognizes only the canonical WilliamOS repository identity", () => {
    expect(validateHelloSourceIdentity("git@github.com:bsvalues/terragroq.git")).toBe(true)
    expect(validateHelloSourceIdentity("https://github.com/bsvalues/terragroq.git")).toBe(true)
    expect(validateHelloSourceIdentity("https://github.com/bsvalues/other.git")).toBe(false)
  })

  it("pins HTTPS to the isolated ports and strips forged proxy/device identity headers", () => {
    expect(HELLO_HTTPS_PORT).toBe(3543)
    expect(HELLO_UPSTREAM_PORT).toBe(3201)
    expect((helloHttpsProxy as { HELLO_UPSTREAM_RESPONSE_TIMEOUT_MS?: number }).HELLO_UPSTREAM_RESPONSE_TIMEOUT_MS).toBe(5_460_000)
    const headers = buildHelloProxyUpstreamHeaders({
      host: "evil.example:9999",
      origin: "https://evil.example",
      "x-forwarded-host": "forged",
      "x-williamos-device-cert": "forged-device",
      cookie: "session=owner",
    })
    expect(headers.host).toBe("williamos.lan:3543")
    expect(headers["x-forwarded-host"]).toBe("williamos.lan:3543")
    expect(headers["x-forwarded-port"]).toBe("3543")
    expect(headers["x-forwarded-proto"]).toBe("https")
    expect(headers["x-williamos-device-cert"]).toBeUndefined()
    expect(headers.origin).toBeUndefined()
    expect(headers.cookie).toBe("session=owner")

    const approved = buildHelloProxyUpstreamHeaders({
      origin: "https://williamos.lan:3543",
      cookie: "session=owner",
    })
    expect(approved.origin).toBe("https://williamos.lan:3543")
  })
})
