#!/bin/sh

new_deps_present(){
    # check if a dry run of npm install will log that a new pkg is added
    # --no-progress to supress progress bar printing
    # -q is Quiet. Return 0 if PATTERN is found, 1 otherwise
    npm install --dry-run --no-progress | grep -q 'added'
}

if [ ! -d "node_modules" ];then
    # run a clean install (package-lock.json won't be modified)
    echo "Running npm clean-install"
    npm ci
elif new_deps_present ;then
    # update node_modules with current package.json deps
    echo "Running npm install"
    npm install
fi

npm run startDev
