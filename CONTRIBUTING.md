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
    docker compose up --build
    ```
    
    The above command shall show the logs of all the containers (see the `docker-compose.yml` file to check the container names) spun up by `docker compose`. Wait for the `earthquake-hub-backend-dev` container to log its “http://IP:PORT” before starting to code/test.
    
    Due to the local bind mount to the docker container, your changes in you the local directory should reflect to changes in the container. As such, you should be able to cycle with code-save-test without having to restart the docker containers
    
    > ℹ️ Useful docker recipes
    1. Start the (pre-built) containers in background: `docker compose start`
    2. See the logs of the services: `docker compose logs -f [backend, redis, etc]`
    3. Stop the containers `docker compose stop`
    4. Add or remove npm packages (⚠️ Don't use npm command locally to avoid package-lock.json issues, use it inside docker like in the following command)
        ```bash
        # Example, installing jest as a dependency
        docker exec earthquake-hub-backend-dev npm install --save-dev jest
        # edit the npm command as needed
        ```
    5. Remove node_modules via docker exec as well
        ```bash
        docker exec earthquake-hub-backend-dev rm -rf node_modules
        ```
    > 
## Git Practices
1. It is encouraged to use atomic commits on your branches. 
2. Follow these for your commit messages:
    1. `feat`: The new feature you're adding to a particular application
    2. `fix`: A bug fix
    3. `style`: Feature and updates related to styling
    4. `refactor`: Refactoring a specific section of the codebase
    5. `test`: Everything related to testing
    6. `docs`: Everything related to documentation
    7. `chore`: Regular code maintenance.
 

## Pull Request Process

1. PR your branch into `dev`
2. Follow the PR document template. Be as detailed as possible. Minimize the need for the reviewers to ask further questions.
3. Use the this format for the PR Title: `type: [TASK ID] SHORTENED TASK TITLE`
4. PR types:
    1. `draft`: to be completed PR
    2. `feat`: new feature
    3. `fix`: bug fixes
    4. `test`: unit or integration tests
    5. `chore`: (aka housekeeping) cleaning/styling/refactor code, documentations, adding comments

## Miscellaneous Notes

1. If you want to develop locally (outside of Docker) you need to install and use `node:14.17.6` and `npm:6.14.15`. The npm version is specially important for now to avoid altering the package-lock.json to a version that won’t be compatible to docker compose. 
2. There are test files available in the __test__/ directory, and this repo uses `jest` as test runner.
