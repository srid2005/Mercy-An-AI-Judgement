# The main screen -- three tabs, no build step (plain HTML/CSS/JS, matching
# Loop/Quill/Wisp/Haven's own player-facing pages). Talks to mercy-engine
# (4010), Meera's laptop (3000) and the City Map (4011) straight from the
# browser; no backend of its own.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
EXPOSE 80
