FROM node:22-bookworm-slim

WORKDIR /opt/operator
COPY runtime-operator/audit.mjs ./audit.mjs
COPY runtime-operator/supervisor.sh ./
RUN sed -i 's/\r$//' supervisor.sh \
  && chmod 0555 supervisor.sh \
  && useradd --create-home --uid 10001 --gid operator operator \
  && mkdir -p /state /audit /workspace \
  && chown -R operator:operator /state /audit /workspace

USER operator
ENTRYPOINT ["/opt/operator/supervisor.sh"]
