FROM __BASE_IMAGE_ID__
WORKDIR /opt/williamos
COPY --chown=10000:10000 server.mjs read-preview.mjs /opt/williamos/
ENV NODE_ENV=production
USER 10000:10000
ENTRYPOINT ["/usr/local/bin/node", "/opt/williamos/server.mjs"]
CMD []
