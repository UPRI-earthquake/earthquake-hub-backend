## Prerequisites
1. Make sure you have `git` installed.
2. Make sure you have `docker` installed.

## Setting Up The Repository On Your Local Machine
1. Clone the repository
    
    ```bash
    git clone git@github.com:UPRI-earthquake/earthquake-hub-backend.git
    ```
2. Create a file named `.env` and set its values based on `.env.example`. You can keep most of the default values, but set your own `PG_PASSWORD` (see [POSTGRES.md, 1.1](POSTGRES.md#11-add-the-postgresql-keys-to-your-env)). No MongoDB keys are needed.
3. Install all dependencies via:
    ```bash
    npm install
    ```
4. Build the image via:
    ```bash
    docker build -t ghcr.io/upri-earthquake/earthquake-hub-backend:latest .
    ```
5. Start the docker containers via:
    ```bash
    docker compose up
    ```
    The above command starts the backend (`earthquake-hub-backend-dev`) and PostgreSQL (`earthquake-hub-postgres`) and shows their logs. Wait for the `earthquake-hub-backend-dev` container to log its “http://IP:PORT” before starting to code/test.
    
    Due to the local bind mount to the docker container, your changes in you the local directory should reflect to changes in the container. As such, you should be able to cycle with code-save-test without having to restart the docker containers.

    Installing npm modules should be done simply by running npm install in the local directory. This should also be reflected within the docker container due to the bind mount.
    
    See [this cheatsheet](https://upri-earthquake.github.io/docker-cheatsheet) for useful docker recipes.
6. Apply the database migrations and load the test data, from the repo root in another terminal:
    ```bash
    npm run db:pg:migrate
    npm run db:pg:seed
    ```
    Docker Compose doesn't run them for you. The migrations create the tables. The seed adds dev's 906 earthquakes and a few test accounts and sensors; the test accounts' password is `Qa-Password-2026!`. For what's in it, or to connect with a GUI client, see [POSTGRES.md](POSTGRES.md#14-load-test-data).

## Publishing container image (For admins)
1. Build the image, and tag with the correct [semantic versioning](https://semver.org/): 
    > Note: replace X.Y.Z, and you should be at the same directory as the Dockerfile

    ```bash
    docker build -t ghcr.io/upri-earthquake/earthquake-hub-backend:X.Y.Z .
    ```
2. Push the image to ghcr.io:
    ```bash
    docker push ghcr.io/upri-earthquake/earthquake-hub-backend:X.Y.Z
    ```
    > ℹ️ Note: You need an access token to publish, install, and delete private, internal, and public packages in Github Packages. Refer to this [tutorial](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry) on how to authenticate to the container registry.


## Development Workflow: Create New Feature
Please refer to the [contributing guide](https://upri-earthquake.github.io/dev-guide-contributing) to the entire EarthquakeHub suite.

## Miscellaneous Notes

1. If you want to develop locally (outside of Docker) make sure you install high enough version of node and npm (as of writing we are running node v18). The npm version is specially important for now to avoid altering the package-lock.json to a version that won’t be compatible to the docker image. 
2. There are test files available in the __test__/ directory, and this repo uses `jest` as test runner. `npm test` runs the unit tests; `npm run test:integration` runs the `*.integration.test.js` files against throwaway PostgreSQL containers, so it needs Docker (see [POSTGRES.md, section 4](POSTGRES.md#4-integration-tests)).
