## Installation and Setup
```
npm i -g @jltorresm/freephite-cli

# Get a Github Access Token from https://github.com/settings/tokens
# Use a "classic token" for now (7/14/2023)
fp auth-fp -t <YOUR_GITHUB_ACCESS_TOKEN>
```

## Update the CLI
```
npm i -g @jltorresm/freephite-cli@latest
```


## (WIP) Develop Locally
```
git clone https://github.com/jltorresm/freephite
cd freephite
yarn install

# Install turbo
npm i -g turbo
turbo build

# If you're working in ~/apps/cli run:
yarn build

# To test your local build
node ~path/to/freephite/apps/cli/dist/src/index.js
```

## Install Develop Version Locally
```
cd ~path/to/freephite/apps/cli
yarn dev
```


## Publish
```
cd ~path/to/freephite/apps/cli
npm publish
```
