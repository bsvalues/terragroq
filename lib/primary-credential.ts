export type PrimaryCredentialPayload = {
  email?: unknown
  name?: unknown
  password?: unknown
  confirmPassword?: unknown
}

export type PrimaryCredentialInput = {
  email: string
  name: string
  password: string
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function validatePrimaryCredentialPayload(
  payload: PrimaryCredentialPayload,
): PrimaryCredentialInput {
  const email = readString(payload.email).toLowerCase()
  const name = readString(payload.name) || "Primary Operator"
  const password = readString(payload.password)
  const confirmPassword = readString(payload.confirmPassword)

  if (!email) {
    throw new Error("Primary email is required.")
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Primary email must be a valid email address.")
  }

  if (!password) {
    throw new Error("Primary password is required.")
  }

  if (password.length < 8) {
    throw new Error("Primary password must be at least 8 characters.")
  }

  if (password.length > 128) {
    throw new Error("Primary password must be 128 characters or fewer.")
  }

  if (password !== confirmPassword) {
    throw new Error("Primary password confirmation did not match.")
  }

  return { email, name, password }
}

export function classifyPrimaryCredentialOperation(declaredPrimaryExists: boolean) {
  return declaredPrimaryExists ? "recovery" : "provisioning"
}
