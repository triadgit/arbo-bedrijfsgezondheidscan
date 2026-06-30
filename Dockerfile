# Statische bedrijfsgezondheidscan: nginx serveert de inhoud van public/.
# Geen build-stap, geen Node in productie. Puur statics.
FROM nginx:alpine

# Custom nginx-config (gzip, cache-headers, json mime-type, index.html fallback).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# De volledige web root: index.html + assets/ + config/.
COPY public/ /usr/share/nginx/html/

EXPOSE 80

# nginx:alpine start zelf al via zijn default CMD; expliciet voor de duidelijkheid.
CMD ["nginx", "-g", "daemon off;"]
