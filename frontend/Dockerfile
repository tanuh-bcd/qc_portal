FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

COPY . .

ARG REACT_APP_API_URL
ARG REACT_APP_WEBSITE_URL
ARG REACT_APP_LINKEDIN_URL
ARG REACT_APP_TWITTER_URL
ARG REACT_APP_YOUTUBE_URL
ARG REACT_APP_MIXPANEL_TOKEN
ENV REACT_APP_API_URL=${REACT_APP_API_URL}
ENV REACT_APP_WEBSITE_URL=${REACT_APP_WEBSITE_URL}
ENV REACT_APP_LINKEDIN_URL=${REACT_APP_LINKEDIN_URL}
ENV REACT_APP_TWITTER_URL=${REACT_APP_TWITTER_URL}
ENV REACT_APP_YOUTUBE_URL=${REACT_APP_YOUTUBE_URL}
ENV REACT_APP_MIXPANEL_TOKEN=${REACT_APP_MIXPANEL_TOKEN}

RUN npm run build

FROM nginx:alpine AS runtime

COPY --from=builder /app/build/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
