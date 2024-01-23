# TLDR
[![CircleCi](https://circleci.com/gh/techaid-tech/techaid-dashboard.svg?style=svg)](https://circleci.com/gh/techaid-tech/techaid-dashboard)

This repo is the source for the UI provided at https://app.communitytechaid.org.uk/

```bash
# Ensure you have installed nodejs and NPM locally
# Install Node Version Manager / Install Node Version >= 12
# Install angular-cli
npm install -g @angular/cli
nvm install 14
nvm use 14
# You will need to have the api running locally on localhost 
ng serve 
```

# Upgrade Angular CLI
## Upgrade NPM
    Download updated package from https://registry.npmjs.org/npm/-/npm-${version}.tgz
    Unpack and copy to the original npm location. 
    run npm -v to verify its updated

## Upgrade Angular CLI
View update site to ensure the steps match the ones outlined below https://update.angular.io/

```bash
    npm uninstall -g angular-cli
    npm cache verify
    # In your current directory with node_modules
    rm -rf node_modules
    npm uninstall --save-dev angular-cli
    npm install --save-dev @angular/cli@latest
    npm install
    # Use ng update to show possible app updates
    ng update 
    ng update --all --force 
    # Verify update
    ng update
    # Update this readme
```
## Development server

_See below for setting up the dev environment_

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The app will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `npm run build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI README](https://github.com/angular/angular-cli/blob/master/README.md).

Force deploy 


## Setting up the Dev environment

The setup branch contains the docker files and modifications necessary for setting up a local dev environment. This may be moved to a submodule later. 

Steps to follow: 

- Ensure that the `techaid-server-web-1` container is running (this is the backend. Follow the instructions on the repo to set it up). This container uses the same network as the backend container. 
- Run `docker compose up -d`

You should now be good to go. 

### Issues and Notes:
- For `ng serve` to work correctly without CORS issues, we use `proxy.conf.json` where we define the proxy for the backend api. Currently this is set to the name of the backend container. Change this if your backend url changes. 
- The way these containers are setup, the backend API is contacted using the name of the container running the backend API. This is because the containers are connected to the same virtual docker network in the docker compose file. If running on Linux, the frontend container can be started in the "host network mode" to access `localhost:8080` directly (assuming the backend container is available on 8080 on the host machine. Host network mode is not supported on Windows/Mac). On Windows/Mac, this can be achieved using `host.docker.internal:8080` domain. This might be useful when configuring nginx or to change the configuration in `proxy.conf.json` to steer clear of depending on container name.  