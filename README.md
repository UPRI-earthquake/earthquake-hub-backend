# earthquake-hub-backend
Backend code for the EarthquakeHub web app

## Publishing container image
1. Make sure that any changes from the env-file are also reflected in the commons repository docker-compose (TODO: predefine the env vars in the Dockerfile itself, instead of only on the env-file). This will ensure that when the commons uses this repository, it is using the env-vars that are expected by the image.
2. Build the image, and tag with the correct [semantic versioning](https://semver.org/): 
    > Note: replace X.Y.Z, and you should be at the same directory as the Dockerfile

    ```bash
    docker build -t ghcr.io/prokorpio/earthquake-hub-backend:X.Y.Z .
    ```
3. Push the image to ghcr.io:
    ```bash
    docker push ghcr.io/prokorpio/earthquake-hub-backend:X.Y.Z
    ```


## ----- The following info is outdated -----

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

