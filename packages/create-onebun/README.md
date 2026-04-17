# @onebun/create

Scaffold a new [OneBun](https://github.com/RemRyahirev/onebun) project in seconds.

## Usage

```bash
bun create @onebun my-app
cd my-app
bun run dev
```

## What you get

```
my-app/
  src/
    index.ts          # Application entrypoint
    config.ts         # Typed env config (PORT, HOST)
    app.module.ts     # Root module
    app.controller.ts # Example controller
    app.service.ts    # Example service
  package.json
  tsconfig.json
  docker-compose.yml  # Postgres + Redis
  .env.example
```

Dependencies are installed automatically via `bun install`.

## Requirements

- [Bun](https://bun.sh) v1.2.12+

## License

[MPL-2.0](../../LICENSE) 
