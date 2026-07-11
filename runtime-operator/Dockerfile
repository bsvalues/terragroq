FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.142.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git curl \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && npm install --global "@openai/codex@${CODEX_VERSION}" \
  && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /opt/operator
COPY scripts/runtime-operator ./scripts/runtime-operator
COPY runtime-operator/codex-output.schema.json ./schema/codex-output.schema.json
COPY runtime-operator/audit.mjs ./audit.mjs
COPY runtime-operator/local-cycle.sh runtime-operator/supervisor.sh ./
RUN chmod 0555 local-cycle.sh supervisor.sh \
  && useradd --create-home --uid 10001 --gid operator operator \
  && mkdir -p /state /audit /workspace \
  && chown -R operator:operator /state /audit /workspace

USER operator
ENTRYPOINT ["/opt/operator/supervisor.sh"]
