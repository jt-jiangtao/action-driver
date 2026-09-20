FROM node:20.19-bookworm-slim

WORKDIR /workspace
RUN npm install --global pnpm@10.17.1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "check"]
