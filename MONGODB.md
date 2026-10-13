# MongoDB: Local Setup & Connecting with Compass

The backend uses **MongoDB 8.0** running in Docker, with **authentication** and a **single-node replica set** (needed for transactions). This guide covers:

1. [First-time local setup](#1-first-time-local-setup)
2. [Connecting with MongoDB Compass](#2-connecting-with-mongodb-compass)
3. [Connecting to a shared server (dep-test / prod)](#3-connecting-to-a-shared-server-dep-test--prod)
4. [Troubleshooting](#4-troubleshooting)

---

## 1. First-time local setup

### 1.1 Add the MongoDB keys to your `.env`

Copy these keys from [`.env.example`](.env.example) into your `.env` and set your own passwords. `.env` is gitignored, so they stay on your machine.

```env
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=<long random password>
MONGO_USER=ehub_app
MONGO_PASSWORD=<another long random password>
MONGO_AUTH_SOURCE=admin
MONGO_REPLICA_SET=rs0
```

To generate a password that's safe to paste into a connection string:

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

| User | Used by | Access |
|---|---|---|
| `admin` (`MONGO_INITDB_ROOT_*`) | You, for user management | Everything |
| `ehub_app` (`MONGO_USER`) | The backend, and you for everyday browsing | Read/write on `latestEQs` only |

### 1.2 Create the database volume and start

The volume is declared `external`, so Docker Compose won't create it for you:

```sh
docker volume create earthquake-hub-mongodb-data
docker compose up -d
docker compose ps        # mongodb should show (healthy) within ~30 seconds
```

On the first start of an **empty** volume, MongoDB:

- creates the `admin` user from `MONGO_INITDB_ROOT_*`
- runs [`mongo-init/create-app-user.js`](mongo-init/create-app-user.js) to create `ehub_app`
- initiates the replica set `rs0` (done by the container's healthcheck)

The backend waits until MongoDB is healthy before starting.

### 1.3 Check it works

```sh
docker exec mongodb mongosh --quiet latestEQs --eval "db.accounts.countDocuments()"
# → MongoServerError: Command aggregate requires authentication   (auth is on, as expected)

docker exec mongodb mongosh --quiet -u admin -p "<root password>" --authenticationDatabase admin --eval "rs.status().members[0].stateStr"
# → PRIMARY
```

### Updating from an older setup (MongoDB 5.0, or no auth)

Your existing volume was created without users and can't be reused. If you don't need its data, recreate it:

```sh
docker compose down
docker volume rm earthquake-hub-mongodb-data
docker volume create earthquake-hub-mongodb-data
docker compose up -d
```

This **deletes all local data** in that volume.

---

## 2. Connecting with MongoDB Compass

Port 27017 is published on `127.0.0.1` only, so you can connect from your own machine.

1. Open Compass → **New connection**.
2. Paste the URI below, replacing `<MONGO_PASSWORD>` with the value from your `.env`:

   ```
   mongodb://ehub_app:<MONGO_PASSWORD>@localhost:27017/latestEQs?authSource=admin&directConnection=true
   ```

3. Click **Connect**, then open the `latestEQs` database.

To manage users or see other databases, connect as admin instead:

```
mongodb://admin:<MONGO_INITDB_ROOT_PASSWORD>@localhost:27017/?authSource=admin&directConnection=true
```

Use `ehub_app` for day-to-day browsing, so you can't accidentally change anything outside `latestEQs`.

### Why `directConnection=true` is required

The replica set member is registered as `mongodb:27017`, a hostname that only resolves **inside** Docker. Without `directConnection=true`, Compass discovers that hostname from the replica set and the connection hangs or fails.

The backend container doesn't need this option because it runs inside Docker, where `mongodb` resolves.

### If your password has special characters

Characters such as `@ : / ? # %` must be URL-encoded in the URI (e.g. `@` → `%40`). The generator command in [1.1](#11-add-the-mongodb-keys-to-your-env) only produces safe characters, so its output needs no encoding. Alternatively, use Compass's **Advanced Connection Options → Authentication** tab and type the username and password there.

---

## 3. Connecting to a shared server (dep-test / prod)

On the servers, MongoDB is also bound to `127.0.0.1`, so it can't be reached directly from outside. You need two things:

1. **Your own MongoDB user**, created by whoever holds the server's admin account. Don't use the backend's `ehub_app` credentials. The admin can create a user like this:

   ```js
   // on the server: docker exec -it mongodb mongosh -u admin -p --authenticationDatabase admin
   db.getSiblingDB('admin').createUser({
     user: 'your.name',
     pwd: passwordPrompt(),
     roles: [{ role: 'read', db: 'latestEQs' }],   // read-only for prod
   });
   ```

2. **SSH access to the server**, to open a tunnel:

   ```sh
   ssh -L 27018:localhost:27017 <user>@<server>
   ```

   Port `27018` on your machine is used so it doesn't clash with your local MongoDB on `27017`. Keep this terminal open while you use Compass.

Then connect Compass to:

```
mongodb://your.name:<password>@localhost:27018/latestEQs?authSource=admin&directConnection=true
```

Never copy production data into your local database. It contains personal data (emails, password hashes, device credentials).

---

## 4. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `external volume "earthquake-hub-mongodb-data" not found` | The volume is declared `external` | `docker volume create earthquake-hub-mongodb-data` |
| `required variable MONGO_INITDB_ROOT_USERNAME is missing` (or another `MONGO_*`) | Key missing from `.env` | Add the keys from [1.1](#11-add-the-mongodb-keys-to-your-env) |
| `mongodb` never becomes healthy; logs mention feature compatibility version | Volume was created by an older MongoDB (e.g. 5.0) | Recreate the volume (see [Updating from an older setup](#updating-from-an-older-setup-mongodb-50-or-no-auth)) |
| `Authentication failed` in the backend or Compass | Volume was created before you set or changed the passwords, so the users don't match `.env` | Recreate the volume, or update the user's password as admin with `db.getSiblingDB('admin').changeUserPassword('ehub_app', '<new>')` |
| Compass hangs or says `getaddrinfo ENOTFOUND mongodb` | Missing `directConnection=true` | Add `&directConnection=true` to the URI |
| `connect ECONNREFUSED 127.0.0.1:27017` | Container not running | `docker compose up -d`, then `docker compose ps` |
| Backend logs `Error connecting to /sse-...` | Ringserver isn't running locally | Expected in local development; unrelated to MongoDB |
