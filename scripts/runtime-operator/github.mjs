const API = "https://api.github.com"

export function githubContext() {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/")
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY is required")
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN is required")
  return { owner, repo, token }
}

export async function githubRequest(path, options = {}) {
  const { token } = githubContext()
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
  if (response.status === 204) return null
  return response.json()
}

export async function ensureLabel(name, color, description) {
  const { owner, repo } = githubContext()
  try {
    await githubRequest(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`)
  } catch (error) {
    if (!String(error).includes("GitHub API 404")) throw error
    await githubRequest(`/repos/${owner}/${repo}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color, description }),
    })
  }
}

export async function setIssueLabels(issueNumber, labels) {
  const { owner, repo } = githubContext()
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: "PUT",
    body: JSON.stringify({ labels }),
  })
}

export async function commentOnIssue(issueNumber, body) {
  const { owner, repo } = githubContext()
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  })
}
