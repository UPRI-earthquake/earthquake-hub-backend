# CONTRIBUTING.md

## Setting Up for Local (in Docker) Development

1. Prerequisites
    1. Make sure you have `git` installed
    2. Make sure you have `docker` installed
2. Download the repository
    
    ```bash
    git clone git@github.com:prokorpio/UPRI-DC-back-end.git
    ```
    
3. Create a file named `.env` and set its values based on `.env.example`. You should be able to use the default values in the example file.
4. Build and start the docker containers
    
    > ⚠️ Because the compose file runs a `mysql` instance that binds to port `3306`, make sure to disable any running instance of `mysql` on the host machine. In Ubuntu, the command is `systemctl stop mysql`.
    > 
    
    ```bash
    docker compose -f docker-compose.backend-dev.yml up --build
    ```
    
    The above command shall show the logs of all the containers (see the `docker-compose.backend-dev.yml` file to check the container names) spun up by `docker compose`. Wait for the `latest-earthquakes-ph-backend-dev` container to log its “http://IP:PORT” before starting to code/test.
    
    Due to the local bind mount to the docker container, your changes in you the local directory should reflect to changes in the container. As such, you should be able to cycle with code-save-test without having to restart the docker containers
    
    > ℹ️ Some useful docker recipes
    1. Start and run the containers in background: `docker compose -f <yml-file> up -d`
    2. See the logs of the services: `docker compose logs -f [backend, redis, etc]`
    3. Stop the containers `docker compose -f <yml-file> down`
    > 

## Pull Request Process

1. PR your branch into `dev`
2. Follow the PR document template

## Miscellaneous Notes

1. If you want to develop locally (outside of Docker) you need to install and use `node:14.17.6` and `npm:6.14.15`. The npm version is specially important for now to avoid altering the package-lock.json to a version that won’t be compatible to docker compose. 
2. There are test files available in the __test__/ directory, and this repo uses `jest` as test runner.