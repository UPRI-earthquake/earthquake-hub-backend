This repo contains the backend code for UPRI earthquake monitoring system
This branch is for development.

Steps to setup
1. Clone frontend, backend, and sc-api repositories.
2. On sc-api, install services on /etc/systemd/system, then enable.
3. On frontend, create certs folder with pem keys
3. On frontend, create .env from .env.example
4. On backend, setup config.js from config.example.js
5. On backend, setup .env from .env.example
6. On host mysql, add ",172.17.0.1" on to bind-address on /etc/mysql/mysql.conf.d/mysqld.cnf, assuming MySQLv8.0.13+

