#!/usr/bin/env bash

# Fix Nginx configuration issues
sudo sed -i '/http {/a\    server_names_hash_bucket_size 128;' /etc/nginx/nginx.conf
sudo sed -i '/http {/a\    types_hash_max_size 2048;' /etc/nginx/nginx.conf

# Restart Nginx to ensure the changes take effect
sudo nginx -t
sudo systemctl restart nginx

# Run Certbot to obtain an SSL certificate
sudo certbot -n -d minervascleaningservice.us-east-1.elasticbeanstalk.com --nginx --agree-tos --email ksmetler@gmail.com
sudo certbot -n -d minervascleaningservice.is404.net --nginx --agree-tos --email ksmetler@gmail.com

# Restart Nginx again to apply the new certificate
sudo systemctl restart nginx
