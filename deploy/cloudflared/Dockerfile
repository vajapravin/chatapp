FROM cloudflare/cloudflared:latest AS bin
FROM alpine:3.19

COPY --from=bin /usr/local/bin/cloudflared /usr/local/bin/cloudflared

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["if [ -z \"$TUNNEL_TOKEN\" ]; then echo '[cloudflared] No CLOUDFLARE_TUNNEL_TOKEN configured. Waiting in standby mode...'; sleep infinity; else exec cloudflared tunnel --no-autoupdate run --token \"$TUNNEL_TOKEN\"; fi"]
