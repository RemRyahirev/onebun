# Changelog

## 0.4.5 — 2026-08-08

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.4 | 0.4.5 |
| `@onebun/nats` | 0.4.2 | 0.4.3 |
| `@onebun/drizzle` | 0.4.2 | 0.4.3 |

### Security

- **🔒 Authorization bypass — a route-level `@UseGuards` above the method decorator never ran** — `@UseGuards(DenyGuard)` written above `@Delete('/:id')` answered HTTP 200 with the handler reached; the same guard written below it answered 403. `@UseInterceptors` and `@UseFilters` were skipped in exactly the same way, so a route could also silently lose its exception filter. Controller-level decorators were unaffected by the ORDER defect, which is why it was invisible to anyone testing only class-level guards — but note that a class-level `@UseGuards` is not inherited by a subclass controller either, a separate and still-open defect, so an audit should cover both. The route decorator snapshotted its pipeline metadata at decoration time, and TypeScript applies method decorators bottom-up, so anything written above the method decorator executed after the snapshot and was discarded. Decorator source order no longer changes runtime behaviour at either level, and a 12-case matrix over both orders for all three decorators now pins it. **Affects 0.4.4 and earlier, and the documentation used the broken order in every route-level example** — audit every route-level `@UseGuards`, `@UseInterceptors` and `@UseFilters` in your codebase; anything written above the `@Get`/`@Post`/`@Delete` decorator was not running. No source change is needed after upgrading, since both orders now work, but routes that were unguarded in production should be treated as having been exposed (`@onebun/core`)
- **🔒 Guards receive dependency injection** — guards were the only element of the documented request pipeline with no DI at all: each was constructed with `new guard()` and no arguments on every request. A guard extending `BaseService` therefore saw `this.config` and `this.logger` as `undefined` inside `canActivate`, so the documented `this.config.get('auth.apiKey')` example threw a `TypeError` at request time, and constructor dependencies were silently never injected. Dependencies are now resolved through the module that owns the controller, once, when routes are built. **The guard INSTANCE is still constructed per request**, deliberately: guards are the one pipeline element where holding request state on `this` across an `await` has always been safe, and sharing an instance turns that into a cross-request race that authorizes requests it must deny. An instance passed directly — `@UseGuards(new RolesGuard(['admin']))` — is still shared, exactly as before (`@onebun/core`)
- **⚠️ A guard whose constructor dependency cannot be resolved now fails at startup** — it previously booted and ran with the dependency `undefined`, which silently disabled whatever check depended on it. The error names the guard and the missing dependency. Register the DEPENDENCY in the module's `providers`; registering the guard class itself does not help. A guard that takes a plain configuration value rather than an injectable service should be passed as an instance — `@UseGuards(new RolesGuard(['admin']))` — which is unaffected (`@onebun/core`)

### Breaking Changes

- **⚠️ JetStream consumers are created with explicit acknowledgements** — consumers are now created with `ack_policy: explicit` for both `ackMode: 'auto'` and `ackMode: 'manual'`. Previously anything other than `'manual'` produced `ack_policy: none`, under which the server tracks no acknowledgements at all: `max_ack_pending`, `ack_wait`, `max_deliver`, `message.ack()`, `message.nack()`, retries and the dead-letter queue were all inert while the documentation advertised them, and a handler that threw was never redelivered. `ackMode` now selects only *who* acknowledges — the adapter on the handler's behalf, or the handler itself — never whether the server tracks acknowledgements. **Migration:** durable consumers created by earlier releases carry a non-explicit ack policy, and `ack_policy` cannot be changed on an existing consumer, so they must be deleted and recreated: `nats consumer rm <stream> <consumer>`. `subscribe()` detects such a consumer on startup and refuses to start, naming the stream, the consumer and the exact command in the error (`@onebun/nats`)
- **⚠️ `subscribe()` rejects on consumer setup failures** — consumer creation used to blind-add inside a bare `catch {}`, so an authentication denial, a disabled JetStream or a transport timeout was indistinguishable from "the consumer does not exist". `subscribe()` now probes `consumers.info` first and classifies the rejection by its numeric API code: only `ConsumerNotFound` leads to a create, and every other rejection — including a genuine `consumers.add` failure — is rethrown as itself and emitted to `onError` rather than swallowed. An ephemeral subscription that collides with an existing consumer is also rejected instead of hijacking it. An application whose consumers cannot be reconciled now fails to boot instead of running degraded (`@onebun/nats`)
- **⚠️ Conflicting `group` configuration fails fast** — OneBun stamps a hash of the applied consumer configuration onto the consumer's metadata, so a consumer that already matches is left untouched (no `consumers.update` call at all) and a changed configuration is applied with every pre-existing metadata key carried forward. Two services that share a `group` but pass different `consumerConfig` or `retry` options no longer silently overwrite each other's consumer: the second writer sees the hash it just applied already replaced and fails with a reconcile-cycle error naming the diverging fields. Align `consumerConfig`, `prefetch` and `retry.attempts` across the services, or delete the consumer. The stamp uses the `onebun.config-hash`, `onebun.prev-config-hash` and `onebun.reconciled-at` metadata keys, which require nats-server 2.10 or newer (`@onebun/nats`)
- **⚠️ Durable consumers are named per group *and* pattern** — a durable consumer is now named `${group}--${filterSubject}--${digest}` — the sanitised group and subject plus a short digest of the raw pair, since sanitisation alone aliases `orders.*` with `orders.>` — with every character outside `[-\w]` replaced by an underscore, and is no longer the bare group name. Two subscriptions that shared a `group` but filtered different subjects used to collide on one consumer — the second silently took the first's over, so one subject received everything and the other received nothing. They are two consumers now. The same group with the same pattern still resolves to a single durable, which is what lets several instances of a service share the work, so load balancing is unchanged. A subscription without a `group` remains ephemeral and is now named `consumer-<uuid>` from `crypto.randomUUID()` rather than from the millisecond clock, so two of them created in the same millisecond can no longer land on the same name. Consumer identity is not part of the hashed configuration: two subscriptions differing only in `group` carry different durable names but the same config hash. **Migration:** consumers created by the previous release are orphaned by the rename and must be deleted with `nats consumer rm <stream> <consumer>` — OneBun creates the replacements under the new names on the next boot (`@onebun/nats`)
- **⚠️ Consumers are created with `deliver_policy new`** — the delivery policy is now set explicitly on creation instead of being left to whatever the server defaults to. On a stream that retains messages this means a newly created consumer starts from the moment it subscribes: unconsumed messages already in the stream are skipped once on upgrade instead of replaying into handlers. Like `ack_policy`, `durable_name` and `name`, the delivery policy is immutable on an existing consumer, so it is sent on the create path only — the reconciler's update path carries just `ack_wait`, `filter_subject`, `max_ack_pending`, `max_deliver` and `metadata` (`@onebun/nats`)
- **⚠️ A configured queue adapter now enables the queue** — an application that sets `queue.adapter`, `queue.options` or `queue.redis` without `queue.enabled` now constructs and connects that adapter during `app.start()`. Previously the queue was enabled only by a queue decorator on a controller or an explicit `queue.enabled: true`, so a producer-only application booted with the queue silently disabled and every `publish()` was discarded. Such an application will now fail to boot if the broker is unreachable, where it previously started and dropped messages. `queue.enabled: false` alongside an adapter configuration keeps the queue disabled and logs one warning naming the contradiction — it is not an error. The multi-service orchestrator resolves the decision once and passes it to every child. `QUEUE_NOT_ENABLED_ERROR_MESSAGE` was rewritten, so code matching that literal must be updated; code comparing against the exported constant is unaffected (`@onebun/core`)
- **⚠️ Streams pre-provisioned out of band are no longer reset on connect** — the adapter used to send every stream key on every connect, including `max_msgs`, `max_bytes` and `max_age` as an explicit `undefined` when the application had never declared them. The client merges an update with a shallow `Object.assign`, so an explicit `undefined` overwrites whatever the server held: the limits an operator had set were erased at every single startup. The update payload now carries only the keys the application actually declared, and an undeclared key is absent rather than present-and-undefined. `retention`, `storage` and the `num_replicas` default are applied on the create path only — `update` cannot change the first two, and applying a default on update would rewrite a value the application never asked about; a declared `streamDefaults` counts as declared and still reaches both paths. A stream whose storage type or retention policy conflicts with the declared configuration now fails startup with an error naming the field and `nats stream rm`, in place of the opaque `stream name already in use` the server produced when a probe failure was misread as absence. That probe is classified by its numeric API code now: only `StreamNotFound` leads to a create, and a permissions denial or a transport timeout is rethrown as itself (`@onebun/nats`)
- **⚠️ A declaration that would narrow a shared stream fails startup** — subject coverage is checked against the server's own subject list before anything else: if the declaration would no longer cover a subject the stream already stores, startup fails and the error names every dropped subject. Widening the declaration is still allowed. An application narrowing a shared stream now fails to boot until the definitions are aligned across the services, instead of quietly dropping the subjects it stopped covering. The check runs before the configuration hash is compared, so a stale stamp left by an out-of-band `nats stream edit` cannot wave the narrowed declaration through (`@onebun/nats`)

- **⚠️ The JetStream dead-letter queue is implemented, so `deadLetter` stops being inert** — `supports('dead-letter-queue')` returned `true` while `SubscribeOptions.deadLetter` was read nowhere in the adapter: `queue` was ignored outright and `maxRetries` was ignored twice over, so a repeatedly failing message was simply left for the server to exhaust and the dead-letter stream stayed permanently empty. Two behaviours change for anyone who already sets `deadLetter`. First, `maxRetries` now participates in the consumer's `max_deliver`, resolved as `retry.attempts` → `deadLetter.maxRetries` → `consumerConfig.maxDeliver` → `3` — `retry.attempts` stays ahead of it so configurations written before this release keep the exact `max_deliver` they had, but a consumer configured only through `deadLetter.maxRetries` is reconciled to the new value on the next startup. Second, the delivery the server would otherwise have made the last is now republished to `deadLetter.queue` and the original is terminated, instead of being redelivered until `max_deliver` runs out. The same routing applies to `message.nack(false)` and the bare `message.nack()` under `ackMode: 'manual'`; `nack(true)` still asks for redelivery. The copy is published **before** the original is terminated — a failed republish leaves the message exactly as it was and reports the failure to `@OnQueueError`, because losing the payload is the one outcome a dead-letter queue exists to prevent. It keeps the original `id` and gains `dlq.originalPattern`, `dlq.deliveryCount` and `dlq.error` in its metadata. **Migration:** `deadLetter.queue` must be a literal subject bound by a declared stream — a wildcard, or a queue equal to the subscription's own pattern, now throws from `subscribe()` at startup rather than failing on the first dead letter (`@onebun/nats`)
- **⚠️ A `#` outside the final token of a pattern now throws** — `#` translates to the NATS `>` wildcard, which NATS accepts only at the end of a subject, so a pattern such as `#.created` used to ship the syntactically invalid subject `>.created`. The client does not validate subjects locally, so the broker rejected it asynchronously, long after the call that produced it and with nothing tying the failure back to the pattern. Such a pattern now throws where it is written: from the `JetStreamQueueAdapter` constructor for a stream declaration, so the application fails before `connect()`, and from the awaited `publish()` or `subscribe()` call otherwise. The error names the offending pattern and the final-token rule. Use `*` to match a single token, or move the `#` to the end (`@onebun/nats`)

- **⚠️ `@Global()` services are scoped per application, not per process** — a `@Global()` module's service instances, the record of which global modules have been constructed, and the options a dynamic module was imported with all used to live on `globalThis`, so one process held exactly one copy no matter how many applications ran in it. A second `DrizzleModule.forRoot()` or `CacheModule.forRoot()` therefore reused the first application's connection instead of opening its own — a test suite could talk to, and drop, the wrong database. Each application now owns a `GlobalScope` threaded by reference through its whole module tree, and disposes it on `stop()`; in multi-service mode the boundary is the sub-application, so stopping one leaves its siblings untouched. Dynamic-module options are captured at import time, so a later `forRoot()` in the same process cannot retroactively change what an already-running application is using. **Migration:** code that relied on one application's instance leaking into a later application in the same process now sees a fresh instance — this mostly affects test suites that booted several applications and expected shared state; assert on each application's own `getService()` result (`@onebun/core`)
- **⚠️ `exports: [SomeModule]` throws instead of silently doing nothing** — the NestJS module re-export idiom was discarded without a trace: `getServiceTag()` throws for a module class and `getExportedServices()` swallowed the throw, so a re-exported module contributed nothing to its importer. It now throws `OneBunInvalidExportError` naming both modules. **Migration:** the entry was always a no-op, so nothing that relied on it was working — an importer either failed at a controller with no mention of the export, or also imported the module directly and got a second copy of every provider (two `DrizzleService`s, two connection pools). Remove the module from `exports` and import the providing module directly wherever its services are needed (`@onebun/core`)
- **⚠️ `TestingModule.overrideProvider()` reaches services and imported modules** — the override was applied by patching the root module after the whole tree had been built, so it reached root-module controllers only. A service that injected the overridden class, or anything inside an imported module, was **silently ignored**: the mock was accepted and then bypassed with no warning and no error, which is the failure mode that lets a real DI bug ship green. Overrides are now seeded into every module before any provider is constructed, and the real provider is not constructed at all when one replaces it — so a `.useClass()` mock's lifecycle hooks fire exactly once instead of once per module. **Migration:** a test that passed because its mock was ignored will start seeing the mock; tests that hand-wired around the old behaviour can drop the workaround (`@onebun/core`)

### Deprecated

- **`clearGlobalServicesRegistry()` and `getGlobalServicesRegistry()`** — both now operate only on the process-default scope used by a direct `new OneBunModule(...)`, never on an application's own scope, so they can no longer observe or reset what a running application holds. `getGlobalServicesRegistry()` has always returned a copy, so an assertion against it could not have detected a change anyway. Assert on resolved instances — `app.getService(Class)` — instead (`@onebun/core`)

### New Features

- **`deleteDurableConsumer()` on the JetStream adapter, and a documented consumer lifecycle** — `unsubscribe()` and `disconnect()` deliberately never remove a durable consumer (they run on every graceful shutdown, and deleting there would discard its position on each deploy), which left no supported way to decommission one at all. `(queueService.getAdapter() as JetStreamQueueAdapter).deleteDurableConsumer(pattern, group)` does it: `true` when a consumer was removed, `false` when there was none, so it is safe to call twice, and a permissions denial is rethrown rather than reported as "already gone". Stream resolution is strict on this path — an unbound pattern throws and names every declared stream instead of falling back to the first one the way `publish()` and `subscribe()` do, because a typo must not delete a consumer on an unrelated stream. The docs now also state what `group` actually is: on JetStream a PERMANENT server resource named from the group and pattern together, so templating it per run or deploy orphans a consumer every time — name the role, not the deployment; on `NatsQueueAdapter` the same option is a stateless queue group that dies with its members (`@onebun/nats`)
- **⚠️ `PublishOptions.messageId` now enables JetStream deduplication, and `StreamDefinition.duplicateWindow` sets the window** — `messageId` was an inert echo: it reached the message body and came back as `Message.id`, but JetStream keys deduplication strictly off the `Nats-Msg-Id` header, which was never sent. Publishing the same logical message twice stored it twice, so an outbox could not be replayed safely. A caller-supplied `messageId` is now sent as `Nats-Msg-Id` and the server drops a second message carrying an id it has already seen inside the stream's deduplication window. Only a supplied id enables it — omitted or empty, the adapter generates one, uses it as `Message.id` and sends no header, because a generated id is unique per call and would only grow the server's deduplication index. The id still travels in the JSON body, so the wire format is unchanged and existing consumers are unaffected; on the memory, Redis and core-NATS adapters `messageId` remains an echo. `duplicateWindow` (nanoseconds, matching `maxAge`) sets the window per stream and is inherited from `streamDefaults`; omitted, the server's own two-minute default applies. It is sent only when declared, on both the create and the update path, so a window an operator set out of band is never reset by a deploy. **Migration:** a `messageId` reused within the window is now silently rejected — the second message is not stored while `publish()` still resolves with no error and no local signal. Audit any caller passing `messageId` and make sure it is unique per logical message, or drop the option (`@onebun/nats`)
- **`ackMode: 'none'` for fire-and-forget delivery** — `SubscribeOptions.ackMode` accepts a third value alongside `'auto'` and `'manual'`. Under `'none'` a message is delivered exactly once and nothing is acknowledged, so there is no redelivery and no dead-letter routing on any adapter — the mode to choose when losing a message costs less than processing it twice. Everything that depends on the broker tracking delivery state goes inert with it: `retry` (including `retry.attempts`), `deadLetter`, `ack_wait`, `max_deliver`, and the `attempt`, `maxAttempts` and `redelivered` fields on `Message`. A handler that throws still emits `onMessageFailed`, so failures remain observable; the message is simply not retried, and `message.ack()`/`message.nack()` become no-ops on every adapter — on JetStream they are recorded so the subscription still reports the right lifecycle event, but nothing reaches a server that is tracking nothing, so no ack, nak or term is sent and a configured `deadLetter` is not routed to. JetStream creates the consumer with `ack_policy: none` and omits `ack_wait`, `max_deliver` and `max_ack_pending` from the wire entirely — the server accepts them but ignores them, and sending them would record a redelivery policy that cannot occur. Redis skips both the requeue and the dead-letter branch; the in-memory adapter suppresses `nack(true)`, which would otherwise resurrect a message in the one mode that promises a single delivery; `NatsQueueAdapter` gains nothing on the wire, because core NATS never had an acknowledgement protocol, so `'none'` is simply the only mode that describes it truthfully. `'auto'` and `'manual'` are unchanged and existing code needs no edits. One constraint follows from JetStream itself: `ack_policy` is fixed when a consumer is created, so a durable that already exists under one mode cannot be moved between `'none'` and the other two — startup fails naming both policies, and the fix is `nats consumer rm` on that durable (`@onebun/core`, `@onebun/nats`)
- **`ackTimeout` on `@Subscribe` — an acknowledgement deadline per subscription** — `SubscribeOptions.ackTimeout` sets how long the server waits for an acknowledgement before it redelivers, for one subscription. The only knob before was `consumerConfig.ackWait`, which applies to every consumer the application creates, so a handler that takes minutes and one that takes milliseconds had to share a window sized for whichever mattered more. Each side of the boundary keeps its own unit — ackTimeout is in milliseconds; consumerConfig.ackWait is in nanoseconds — and the adapter multiplies by 1_000_000 on the way to the wire. JetStream resolves the consumer's `ack_wait` as `ackTimeout -> consumerConfig.ackWait -> DEFAULT_ACK_WAIT_NANOSECONDS` (30 seconds), so an application that sets neither is unaffected. Because `ack_wait` is one of the fields the reconciliation stamp hashes, a changed value is applied to an existing durable consumer automatically on the next start — no `nats consumer rm` in between — and the consumer's name is unchanged, since a timeout is configuration and not identity. Two processes that disagree on it still fail startup with a reconcile-cycle error, which now reports each diverging field with both values (`ack_wait (this process 45000000000, on server 30000000000)`) rather than only the two config hashes, which name the writers but say nothing an operator can act on. The option is inert under ackMode: 'none', where the server tracks no acknowledgements and there is nothing to time out, and the in-memory, Redis and core-NATS adapters ignore it, having no server-side acknowledgement window at all. Keep it above the slowest run of the handler: a window that expires while the handler is still working redelivers the message and does the work twice. The shutdown drain remains a fixed 30 seconds, so a handler granted a longer `ackTimeout` can still be abandoned by a deploy (`@onebun/core`, `@onebun/nats`)

### Bug Fixes

- **⚠️ A nacked message is reported as failed, not processed, on every adapter** — the documented way to write a handler is a `try`/`catch` whose `catch` calls `message.nack()`. Such a handler never throws, so nothing about its control flow distinguished it from a success: every adapter emitted `onMessageProcessed` for a message it had just dropped or requeued, and `onMessageFailed` fired only when a handler let an exception escape. A service written exactly as the documentation recommends therefore reported a failure rate of structurally zero while losing or retrying messages, and a message that took five attempts counted as five successes. Each adapter now reads the nack the message already recorded and emits `onMessageFailed` with a synthesised error naming it. The flag is read through an adapter-internal accessor (`NackAwareMessage` and `wasNacked()` in `@onebun/core`), so the public `Message` interface is unchanged and handlers cannot read it back. A handler that nacks and then throws still emits exactly one event, carrying the thrown error rather than the synthesised one, and `ack()`/`nack()` are first-call-wins everywhere. The rule does not vary with `ackMode`: `'none'` removes redelivery, not observability. **Migration:** anything counting `onMessageProcessed` as throughput, or alerting on `onMessageFailed`, will see both numbers move on upgrade — the processed count falls by exactly the messages the handlers were already rejecting and the failure count rises by the same amount, so re-baseline the alert rather than treating the step as an incident. Check too that an `@OnMessageFailed` handler tolerates an error it did not raise: the handler never threw, so the `Error` it receives is the framework's (`@onebun/core`, `@onebun/nats`)
- **⚠️ `nack(true)` under `ackMode: 'auto'` on JetStream actually redelivers now** — the consume loop's auto-acknowledgement ran on the raw JetStream message rather than through the framework's wrapper, so it bypassed the wrapper's own first-call-wins guard. A handler that called `message.nack(true)` sent `nak()`, returned, and then had `ack()` sent on the same message microseconds later, settling it and cancelling the redelivery it had just requested; `nack(false)` was terminated and then acked in the same way. Manual redelivery was therefore silently inoperative in the one mode where the framework acknowledges for you — the call succeeded, the server was told twice, and the last word won. The auto-acknowledgement is now skipped for a message the handler already dispositioned. `ackMode: 'manual'` was never affected, because it sends no automatic acknowledgement at all. **Migration:** a handler that has been calling `nack(true)` under `ackMode: 'auto'` starts genuinely redelivering, up to `max_deliver`; if it was relying on the message quietly going away, give it a `deadLetter` queue or switch the call to `nack(false)` (`@onebun/nats`)
- **`@Subscribe` patterns with named parameters now reach NATS as valid subjects** — `@Subscribe('orders.{id}')` created a consumer filtering the literal subject `orders.{id}`, which matches nothing on the broker. Nothing errored: `consumers.add` succeeded, `isConnected()` reported healthy, and the subscription was simply, silently dead. A single translation now runs at every point where a OneBun pattern reaches the wire — the consumer filter, the publish subject, stream declarations and stream resolution: a `{name}` parameter becomes the NATS `*` wildcard, a trailing `#` becomes `>`, and `*` and literal tokens pass through. Translation only ever widens, and the in-process matcher built from the original pattern still narrows the delivery back and rejects anything the pattern does not match, so a subscription never receives more than it asked for. A stream declared as `orders.{id}` binds `orders.*`; publishing is unaffected — `publish('orders.123', …)` still sends `orders.123` (`@onebun/nats`)
- **`Message.attempt` and `Message.maxAttempts` are populated on JetStream** — both fields were declared on the message and never assigned, so they were permanently `undefined`. That made the retry recipe the documentation ships dead code: `if (message.attempt && message.attempt >= (message.maxAttempts || 3))` could never be true, so every failure fell through to `nack(true)` and kept being redelivered until `max_deliver` ran out — the documented terminal branch was unreachable. `attempt` now comes from the delivery count the server already tracks (1-based, so the documented comparison works as written), and `maxAttempts` is the `max_deliver` the subscription's consumer was actually created with, resolved once at subscribe time rather than recomputed per message: with reconciliation the server-side consumer is authoritative, and re-deriving the precedence chain in the consume loop could disagree with the consumer that really exists. Under `ackMode: 'none'` the server tracks nothing, so `attempt` stays 1 by design. On the memory, Redis and core-NATS adapters both fields remain `undefined` for now (`@onebun/nats`)
- **Shutdown waits for handlers that are still running** — `unsubscribe()` and `disconnect()` abandoned any handler that was mid-flight. Its acknowledgement was then published onto a closing connection, where the client buffers it and drops it without raising anything: the handler completed, the server never heard about it, and the message was redelivered after `ackWait`. Since `QueueService.stop()` unsubscribes every subscription on graceful shutdown, that ran on every deploy — duplicating exactly the charge-and-email work the documentation recommends handlers for. Both calls now wait for the running handler, bounded by a fixed 30 seconds matching the default `ackWait`, and `disconnect()` stops each subscription pulling before it waits, so no new handler starts during the drain. Shutdown now takes as long as the slowest handler in flight, where it previously returned immediately (`@onebun/nats`)
- **The queue adapter is no longer connected twice on startup** — `QueueService.initialize()` called `connect()` unconditionally on an adapter the application had already connected, so every boot opened the backend connection twice. It is now guarded by `isConnected()`, matching the guard `QueueService.start()` already applied to the same call (`@onebun/core`)
- **Publishing to an unbound subject reports the real cause** — JetStream stores a message only if some stream on the broker binds its subject, and the server's rejection for an unbound one is `jetstream is not enabled`, which names neither the subject nor the streams. The adapter now re-reports it with the OneBun pattern, the resolved NATS subject and every stream this application declares, keeping the broker's rejection as the error's `cause`. There is no pre-flight check against the local `streams` list — a subject may legitimately be bound by a stream another service owns (`@onebun/nats`)
- **A `@Global()` module reaches importers that were initialized around it** — module initialization read the global registry once, at the top, and then walked `imports`; an entry already initialized by an earlier sibling in the same array was skipped on the assumption that first pass had delivered it. It had not: the sibling registered it afterwards. So `imports: [FeatureModule, CoreModule]` — where `FeatureModule` also imports `CoreModule` — failed at boot with `Could not resolve dependency`, while `imports: [CoreModule, FeatureModule]` booted, a one-token difference between a module that works and one that cannot resolve its own declared import. The same defect hid a global module from an ancestor that did not list it directly. The registry is re-read after the import loop, and an import that re-seeds services from an already-initialized global module now logs a debug line naming both modules and the count — the silence is what made this expensive to find. The module is still constructed exactly once. **This does not make import order entirely irrelevant**: a consumer *inside a subtree that is built earlier in the same `imports` array* still cannot see a registration that comes later in that array, because its subtree finishes constructing before the later entry is reached — `imports: [FeatureModule, CacheModule.forRoot()]` fails when a service deep inside `FeatureModule` injects `CacheService`, and `imports: [CacheModule.forRoot(), FeatureModule]` succeeds. Declaring the configured module first remains the rule until that direction is fixed (`@onebun/core`)
- **A NestJS-style object provider throws instead of vanishing** — `@Module({ providers: [{ provide: X, useValue: v }] })` typechecks against the metadata shape, but every filter downstream drops anything that is not a function, so the entry simply never existed. The failure then surfaced somewhere else entirely, as `Could not resolve dependency` on whichever service expected it. Such an entry now throws `OneBunInvalidProviderError` naming the module and the entry, and pointing at class-based providers and `TestingModule.overrideProvider()` (`@onebun/core`)
- **Lifecycle hooks on a `@Global()` service fire exactly once** — a global instance sits in the service map of every module that can see it, and the four lifecycle passes walked those maps and then recursed into child modules with no record of what they had already visited. `onApplicationInit`, `onModuleDestroy`, `beforeApplicationDestroy` and `onApplicationDestroy` therefore fired once per module — five times in a five-module tree — so a `close()` written in `onModuleDestroy` ran repeatedly against the same connection (`@onebun/core`)
- **By-class service lookups accept a service that has dependencies** — `app.getService()`, `CompiledTestingModule.get()`, `getServiceByClass()`, `getServiceTag()` and `createServiceLayer()` typed their parameter as a constructor taking `unknown[]`, which no class with typed constructor parameters satisfies. Passing any service with injected dependencies — that is, most of them — was a compile error even though the lookup worked perfectly at runtime (`@onebun/core`)

### Improvements

- **JetStream streams are reconciled through a configuration stamp** — OneBun stamps a hash of the applied stream configuration into stream metadata, so a stream that already matches is left untouched — no `streams.update` call at all — and a changed configuration is applied with every pre-existing metadata key carried forward. Two services writing different definitions for the same stream no longer overwrite each other: the second writer sees the hash it just applied already replaced and fails with a reconcile-cycle error naming the diverging fields. The stamp requires nats-server 2.10 or newer, and a rejection that names that requirement is re-reported with it stated (`@onebun/nats`)
- **`consumerConfig.maxAckPending` is honoured** — the option was declared but read nowhere, so anyone who set it silently got 100. Consumer wire values now come from a single resolver with a documented precedence: `max_ack_pending` takes `prefetch`, then `consumerConfig.maxAckPending`, then `100`; `max_deliver` takes `retry.attempts`, then `consumerConfig.maxDeliver`, then `3`; `ack_wait` takes `consumerConfig.ackWait`, then 30 seconds. The pull batch is `min(max_ack_pending, prefetch ?? 10)`, so a subscription can never request more messages than the server will let it hold unacknowledged (`@onebun/nats`)

## 0.4.4 — 2026-04-25

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.3 | 0.4.4 |
| `@onebun/logger` | 0.4.1 | 0.4.2 |

### Breaking Changes

- **⚠️ Fail-fast dependency resolution** — unresolved DI dependencies now throw `DependencyResolutionError` at bootstrap instead of silently injecting `undefined`. Services, controllers, middleware, and interceptors with missing required dependencies will crash immediately with an actionable error message that names the missing dependency and suggests which module to import or export. Use the new `@Optional()` decorator to opt into the previous behavior for intentionally optional dependencies (`@onebun/core`)
- **⚠️ Circular dependencies throw** — circular dependency detection now throws `CircularDependencyError` instead of logging an error and continuing with broken wiring. The error includes the full dependency chain for debugging (`@onebun/core`)
- **⚠️ Missing controller metadata throws** — controllers listed in a module's `controllers` array without a `@Controller()` decorator now throw `OneBunBootstrapError` at startup instead of being silently skipped. WebSocket gateways (`@WebSocketGateway()`) are correctly excluded from this check (`@onebun/core`)

### Improvements

- **`DependencyResolutionError` with diagnostic suggestions** — when a dependency cannot be resolved, the error message searches all registered modules to find where the missing type is provided: suggests adding the module to imports, adding the type to exports, or notes when a global module should have auto-resolved it (`@onebun/core`)
- **`@Optional()` decorator** — marks constructor parameters as optional for DI. When the dependency cannot be resolved, `undefined` is injected instead of throwing. Works with services, controllers, middleware, and interceptors (`@onebun/core`)
- **Per-request trace context isolation** — HTTP request trace context is now stored in `AsyncLocalStorage` instead of `globalThis`, eliminating a race condition where concurrent requests could overwrite each other's trace IDs. Each request gets its own isolated trace context scope via `requestContextStore.run()` (`@onebun/core`)
- **`traceContextGetter` in logger** — `SyncLogger` and `LoggerImpl` now accept a `traceContextGetter` callback for reading per-request trace context from `AsyncLocalStorage`, replacing the `globalThis.__onebunCurrentTraceContext` fallback. The `globalThis.__onebunTraceService` fallback is preserved for non-HTTP contexts (WebSocket, queues) (`@onebun/logger`)
- **Bootstrap error propagation** — `OneBunBootstrapError` and its subclasses (`DependencyResolutionError`, `CircularDependencyError`) are now re-thrown from the service creation catch block instead of being swallowed (`@onebun/core`)

### New Exports

- `DependencyResolutionError`, `CircularDependencyError`, `OneBunBootstrapError` — bootstrap error classes (`@onebun/core`)
- `@Optional()`, `isOptionalParam()` — optional DI parameter decorator and checker (`@onebun/core`)
- `getRegisteredModules()` — iterator over all `@Module()`-registered modules and their metadata (`@onebun/core`)
- `requestContextStore`, `getCurrentTraceContext()`, `RequestContext` — per-request `AsyncLocalStorage` for trace context isolation (`@onebun/core`)
- `LoggerConfig.traceContextGetter` — optional callback for per-request trace context resolution (`@onebun/logger`)

### Tests

- 3 circular dependency tests: direct A↔B cycle, three-way A→B→C→A chain, self-dependency A→A
- 3 fail-fast DI tests: missing required dep throws with error details, suggestion includes module name, `@Optional()` allows graceful undefined
- Updated logger test from `globalThis` trace context to `traceContextGetter` callback
- Fixed 2 existing tests that relied on warn-and-continue behavior for missing controller metadata

## 0.4.2 — 2026-04-24

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.1 | 0.4.2 |
| `@onebun/cache` | 0.4.1 | 0.4.2 |
| `@onebun/docs` | 0.4.2 | 0.4.3 |
| `@onebun/drizzle` | 0.4.1 | 0.4.2 |
| `@onebun/envs` | 0.4.0 | 0.4.1 |
| `@onebun/logger` | 0.4.0 | 0.4.1 |
| `@onebun/metrics` | 0.4.0 | 0.4.1 |
| `@onebun/nats` | 0.4.1 | 0.4.2 |
| `@onebun/requests` | 0.4.1 | 0.4.2 |
| `@onebun/trace` | 0.4.0 | 0.4.1 |

### Improvements

- **Documentation cross-reference system** — new `@see docs:<path>` JSDoc tags link exported symbols to their documentation pages, and `@source docs:<path>#<section>` tags in `docs-examples.test.ts` link tests to the doc snippets they validate. New `bun run docs:xref` script builds forward and reverse maps, validates links, and detects unreferenced or untested doc pages. Supports `--json`, `--markdown`, `--check` (for CI) output modes
- **163 `@see docs:` tags** added across all packages — every exported decorator, class, interface, and factory function now references its documentation page(s)
- **Unified test doc-reference format** — 12 `docs-examples.test.ts` files migrated from ad-hoc `* - docs/api/...` bullet lists and `@source docs/...` to the standardized `@source docs:...` format (198 test references total)

### Documentation

- **`docs/api/guards.md`** — fixed `RolesGuard` description: documented as "at least one required role" (OR logic) but the implementation uses `every()` requiring **all** roles (AND logic)
- **`docs/api/websocket.md`** — added missing `excludeClientIds?: string[]` parameter to `emitToRooms()` and `emitToRoomPattern()` signatures; documented previously undocumented `disconnectRoomPattern(pattern, reason?)` method
- **`docs/api/cache.md`** — fixed `CacheStats` interface: `keys`/`size` corrected to `entries`/`hitRate` matching the actual type definition
- **`docs/architecture.md`** — corrected provider instantiation order (dependency order, not declaration order), controller `onModuleInit` execution (parallel via `Promise.all`), request flow (trace context extraction, exception filter placement, metrics recording), metadata storage description (WeakMap-based system, not Reflect.metadata keys), and DI auto-detection algorithm (removed non-existent constructor source analysis fallback)
- **`docs/getting-started.md`** and **`docs/api/controllers.md`** — removed incorrect "static routes must come before parametric" comments; clarified that Bun's router resolves by specificity

### Other

- New `scripts/docs-xref.ts` cross-reference scanner and `docs:xref` script in `package.json`
- Updated `peerDependencies` in `@onebun/cache`, `@onebun/docs`, `@onebun/drizzle`, `@onebun/nats` to `@onebun/core@^0.4.2`

## 0.4.1 — 2026-04-24

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.0 | 0.4.1 |
| `@onebun/cache` | 0.4.0 | 0.4.1 |
| `@onebun/docs` | 0.4.1 | 0.4.2 |
| `@onebun/drizzle` | 0.4.0 | 0.4.1 |
| `@onebun/nats` | 0.4.0 | 0.4.1 |

### Breaking Changes

- **⚠️ Intra-minor breaking change (rare case)** — `getService()` → `getApplication()` technically breaks semver within 0.4.x. Justified because 0.4.0 shipped less than 24h ago, no known deployments exist, and the rename completes the unified-entry-point breaking change already announced in 0.4.0. Users who already migrated to 0.4.0 must also rename the method call.
- **`getService()` renamed to `getApplication()`** — in multi-service mode, `app.getService(name)` is now `app.getApplication(name)` to avoid confusion with DI service resolution (`@onebun/core`)

### Improvements

- **Interceptors across all transports** — new `Interceptor` interface with `intercept(context, next)` method, `BaseInterceptor` base class with DI support, and `@UseInterceptors()` decorator. Works on HTTP controllers, WebSocket gateways, and queue handlers. Supports global (via `ApplicationOptions.interceptors`), controller/gateway-level, and route/handler-level interceptors with onion-model execution order (`@onebun/core`)
- **Built-in interceptors** — `createInterceptor()` factory for inline interceptors, `LoggingInterceptor` (request timing), `TimeoutInterceptor` (configurable deadline), `TransformInterceptor` (response mapping) (`@onebun/core`)
- **`CacheInterceptor`** — caches HTTP GET 2xx responses via `CacheService`; non-GET and non-HTTP transports pass through. Apply with `@UseInterceptors(CacheInterceptor)` (`@onebun/cache`)
- **`ExecutionContext` type discriminant** — `HttpExecutionContext.type = 'http'`, `WsExecutionContext.type = 'ws'`, `MessageExecutionContext.type = 'queue'` for type-safe narrowing in universal interceptors; `isHttpContext()` / `isWsContext()` / `isQueueContext()` type guards exported (`@onebun/core`)
- **Multi-service mode guards** — single-service methods (`getPort()`, `getConfig()`, etc.) now throw a clear error when called on a multi-service app, and vice versa (`@onebun/core`)
- **Removed `effect` from example dependencies** — examples no longer list `effect` as a direct dependency; it is provided transitively by `@onebun/core`
- **Test script runs examples** — `bun test` now also runs `bun test examples/`

### Documentation

- New `docs/api/interceptors.md` page (468 lines) with full guide: interface, base class, built-in interceptors, execution order, transport-specific usage, DI examples
- Updated request pipeline diagram in `docs/api/controllers.md` to include interceptors step
- `docs/api/core.md`, `docs/api/websocket.md`, `docs/api/queue.md` updated with interceptor references
- `docs/architecture.md` and `docs/features.md` updated to reflect interceptor support
- `docs/migration-nestjs.md` updated with interceptor migration notes
- `docs/roadmap.md` — interceptor items marked as complete; new items added for filters and guard unification across transports
- Navigation sidebar updated with Interceptors page

### Tests

- Added 23 unit tests for interceptor core (`composeInterceptors`, `createInterceptor`, `BaseInterceptor`, `LoggingInterceptor`, `TimeoutInterceptor`, `TransformInterceptor`, context type guards)
- Added 9 HTTP interceptor integration tests (route-level, controller-level, global, short-circuit, onion order, guard+interceptor interaction, guard rejection bypass)
- Added 14 multi-service mode tests (mode detection, mode guards, start/stop integration with filtering by options and ENV)
- Added 7 docs-example tests for interceptor documentation code samples
- Hardcoded ports in guard rejection tests replaced with `port: 0`

### Other

- Removed direct `effect` dependency from `@onebun/cache`, `@onebun/docs`, `@onebun/drizzle`, and example `package.json` files (provided transitively)
- Updated `peerDependencies` in `@onebun/cache`, `@onebun/docs`, `@onebun/drizzle`, `@onebun/nats` to `@onebun/core@^0.4.1`
- `scripts/publish.ts` — minor publish script adjustments

## 0.4.0 — 2026-04-23

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.3.8 | 0.4.0 |
| `@onebun/cache` | 0.3.2 | 0.4.0 |
| `@onebun/docs` | 0.3.4 | 0.4.0 |
| `@onebun/drizzle` | 0.3.3 | 0.4.0 |
| `@onebun/envs` | 0.3.1 | 0.4.0 |
| `@onebun/logger` | 0.3.1 | 0.4.0 |
| `@onebun/metrics` | 0.3.4 | 0.4.0 |
| `@onebun/requests` | 0.3.4 | 0.4.0 |
| `@onebun/trace` | 0.3.4 | 0.4.0 |
| `@onebun/nats` | 0.3.2 | 0.4.0 |
| `@onebun/create` | 0.3.3 | 0.4.0 |

### Breaking Changes

- **`MultiServiceApplication` removed** — replaced by `OneBunApplication` multi-service mode. Pass `{ services: ... }` to the constructor instead of using a separate class. The internal implementation moved to `MultiServiceOrchestrator` (`@onebun/core`)

### Improvements

- **Unified application entry point** — `OneBunApplication` now handles both single-service and multi-service modes via constructor overloads. New methods in multi-service mode: `getApplication(name)`, `getServiceUrl(name)`, `getRunningServices()`, `isServiceRunning(name)` (`@onebun/core`)
- **Optional leading slash in route decorators** — `@Controller('users')` equals `@Controller('/users')`, `@Get(':id')` equals `@Get('/:id')`. NestJS-style paths work out of the box without migration (`@onebun/core`)
- **Version bump script: peerDependencies support** — `bun version:bump` now updates `peerDependencies` alongside `dependencies` and `devDependencies` for `@onebun/*` internal packages

### Documentation

- All docs and examples updated: `MultiServiceApplication` → `OneBunApplication` multi-service mode
- Added leading-slash-optional notes in controllers and decorators docs
- Migration guide: route path format no longer requires changes (step 7 removed)
- `docs/api/core.md` updated with multi-service constructor signature and new methods

## 2026-04-22

### Bug Fixes

- **Guard rejection now returns HTTP 403** — guard reject responses previously returned `200 OK` regardless of `httpEnvelope` setting; now returns `403 Forbidden` by default (`200 OK` when `httpEnvelope: true`), consistent with exception filter behavior (`@onebun/core`)

### Breaking Changes

- **Removed `getService()` / `setService()` from `Controller`** — legacy service-access methods and the internal `services` Map have been removed; use constructor injection instead. `app.getService()` on `OneBunApplication` is unaffected (`@onebun/core`)

### Improvements

- **Decorator order independence** — `@ApiTags`, `@ApiOperation`, and `@ApiResponse` now work correctly regardless of their position relative to `@Controller` or route decorators. The OpenAPI spec generator reads response schemas via `getResponseSchemasMetadata()` (new export) with prototype chain walk, so `@ApiResponse` above `@Get` is now picked up in generated specs (`@onebun/core`, `@onebun/docs`)
- **Removed `__decorate` polyfill** — Bun handles `emitDecoratorMetadata` natively since v1.0.3; the `Reflect.metadata` polyfill is retained as it is still required (`@onebun/core`)

### Documentation

- **AuthGuard** — `docs/roadmap.md` corrected from "token verification" to "Bearer header presence check"; added "Not a Token Validator" warning in `docs/api/guards.md`
- **Guard rejection** — `docs/api/guards.md` llm-only section updated to reflect 403 default
- **Decorator order** — removed all "Decorator Order" warning boxes from `docs/api/docs.md` and `docs/api/decorators.md`
- **Controller API** — removed "Via getService() (Legacy)" section; SSE examples rewritten with constructor injection (`docs/api/controllers.md`, `packages/core/README.md`)

### Tests

- Added 2 integration tests for guard rejection HTTP status codes (403 / 200 with `httpEnvelope`)
- Added 7 tests for decorator order independence (`@ApiTags`, `@ApiOperation`, `@ApiResponse` in both positions)
- Removed 6 obsolete tests (4 `__decorate` polyfill, 1 `getService` controller, 1 `getService` docs-example)

## 2026-04-21

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.3.6 | 0.3.7 |
| `@onebun/drizzle` | 0.3.2 | 0.3.3 |
| `@onebun/metrics` | 0.3.3 | 0.3.4 |
| `@onebun/trace` | 0.3.2 | 0.3.3 |

### Performance

- **Synchronous trace hot path** — replaced Effect-based async calls with sync methods (`extractFromHeadersSync`, `startHttpTraceSync`, `endHttpTraceSync`) on the HTTP request critical path, eliminating `Effect.runPromise()` overhead per request
- **Smart OTel span creation** — OTel spans are only created when an exporter endpoint is configured; lightweight context propagation otherwise
- **Cron parser rewrite** — replaced second-by-second iteration (O(31M) worst case) with field-level skipping through months/days/hours/minutes (O(~1.5K) worst case), ~100–1000x faster
- **SQLite statement caching** (`@onebun/drizzle`) — wraps `client.prepare()` with a Map cache; patches drizzle's `.get()` to use native `stmt.get()` instead of materializing all rows
- **Metrics status code caching** — lazy-cached `toString()` for HTTP status codes, removed per-request `.toUpperCase()` on method strings
- **Pre-compiled traceparent regex** and optimized trace ID generation via `crypto.getRandomValues()` + `Buffer.toString('hex')`

### @onebun/drizzle

- **SQLite pragmas support** — new `pragmas` option in `SQLiteConnectionOptions` (defaults to `journal_mode = WAL`, `synchronous = NORMAL`), executed on connection
- **Statement caching & `.get()` patch** applied automatically on SQLite database init

### @onebun/metrics

- **Exported `register` from prom-client** — downstream packages can now access the Prometheus registry via `@onebun/metrics` without a direct `prom-client` dependency

### Benchmarks

Complete restructuring from a flat directory into three distinct scenarios:

- **`benchmarks/simple/`** — basic HTTP throughput (hello world), successor to the old `run-http.sh`. Competitors: Bun.serve, Hono, Elysia, NestJS+Fastify
- **`benchmarks/realistic/`** (new) — SQLite CRUD with Drizzle ORM, Swagger docs, paginated lists, JOINs, writes. Competitors: NestJS+Fastify (Bun & Node 24), NestJS+TypeORM (Node 24)
- **`benchmarks/realistic-pg/`** (new) — PostgreSQL CRUD with in-memory cache, request validation, and an additional OneBun variant with full observability (`@onebun/metrics` + `@onebun/trace`) to measure overhead. Requires Docker (PostgreSQL 16)
- **`benchmarks/run-all.sh`** — unified runner for all three suites; gracefully skips PostgreSQL benchmarks if Docker is unavailable
- **Startup timing** — replaced `hyperfine` with custom bash timing (`date +%s%N` + HTTP polling)
- **`parse-results.ts`** — expanded to handle per-endpoint metrics for realistic benchmarks, outputs structured JSON with `http`, `startup`, `realistic`, `realisticPg` sections

### Documentation

- **BenchmarkResults.vue** — redesigned to display three benchmark scenarios with methodology descriptions, observability overhead table, and fallback to `benchmark-fallback.json` when gist is unreachable
- **Features page** — reframed validation section as "Out-of-the-Box Validation", noting ArkType is re-exported from `@onebun/core` with zero extra packages
- **Migration guide** — fairer NestJS comparison, acknowledging `nestjs-zod` + `patchNestJsSwagger()` as an alternative; OneBun advantage positioned as zero-config, not uniqueness
- **API docs** — clarified schema messaging ("one schema = type + validation + docs")

### CI

- Added PostgreSQL 16 service container for realistic-pg benchmarks
- Increased workflow timeout from 30 to 45 minutes
- Extended trigger paths to include `packages/drizzle/src/**`, `packages/cache/src/**`, `packages/docs/src/**`
- Replaced separate `run-http.sh` + `startup.sh` with unified `run-all.sh`

### Other

- **Roadmap** — restructured phases, added performance tracks (observability hot path, Drizzle/SQLite), separated post-1.0 ecosystem vision
- **Root dependencies** — removed `prom-client` and `testcontainers` from root `package.json`
- **Gitignore** — added `benchmarks/**/*.db` for SQLite benchmark artifacts
