# Use a lightweight Nginx image
FROM nginx:alpine

# Remove the default Nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom Nginx configuration (handles Service Workers & WASM properly)
COPY nginx.conf /etc/nginx/conf.d/

# Copy all your website files (HTML, CSS, JS, bareworker.js, etc.) into Nginx
COPY . /usr/share/nginx/html

# Expose port 80 for web traffic
EXPOSE 80

# Start Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
