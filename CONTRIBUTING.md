## Prerequisites
1. Make sure you have `git` installed.
2. Make sure you have `docker` installed.

## Setting Up The Repository On Your Local Machine
1. Clone the repository
    
    ```bash
    git clone git@github.com:prokorpio/UPRI-DC-back-end.git
    ```
2. Create a file named `.env` and set its values based on `.env.example`. You should be able to use the default values in the example file.
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
    The above command shall show the logs of all the containers (see the `docker-compose.yml` file to check the container names) spun up by `docker compose`. Wait for the `earthquake-hub-backend-dev` container to log its “http://IP:PORT” before starting to code/test.
    
    Due to the local bind mount to the docker container, your changes in you the local directory should reflect to changes in the container. As such, you should be able to cycle with code-save-test without having to restart the docker containers.

    Installing npm modules should be done simply by running npm install in the local directory. This should also be reflected within the docker container due to the bind mount.
    
    See [this cheatsheet](https://upri-earthquake.github.io/docker-cheatsheet) for useful docker recipes.

## Publishing container image (For admins)
1. Build the image, and tag with the correct [semantic versioning](https://semver.org/): 
    > Note: replace X.Y.Z, and you should be at the same directory as the Dockerfile

    ```bash
    docker build -t ghcr.io/upri-earthquake/earthquake-hub-frontend:X.Y.Z .
    ```
2. Push the image to ghcr.io:
    ```bash
    docker push ghcr.io/upri-earthquake/earthquake-hub-frontend:X.Y.Z
    ```
    > ℹ️ Note: You need an access token to publish, install, and delete private, internal, and public packages in Github Packages. Refer to this [tutorial](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry) on how to authenticate to the container registry.


## Development Workflow: Create New Feature
Please refer to the [contributing guide](https://upri-earthquake.github.io/dev-guide-contributing) to the entire EarthquakeHub suite.

## Miscellaneous Notes

1. If you want to develop locally (outside of Docker) make sure you install high enough version of node and npm (as of writing we are running from node v15.11 to v20.0). The npm version is specially important for now to avoid altering the package-lock.json to a version that won’t be compatible to the docker image. 
2. There are test files available in the __test__/ directory, and this repo uses `jest` as test runner.
