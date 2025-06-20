import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __legacyDecorateClassTS = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
    r = Reflect.decorate(decorators, target, key, desc);
  else
    for (var i = decorators.length - 1;i >= 0; i--)
      if (d = decorators[i])
        r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __legacyMetadataTS = (k, v) => {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function")
    return Reflect.metadata(k, v);
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/effect/dist/esm/Function.js
function pipe(a, ab, bc, cd, de, ef, fg, gh, hi) {
  switch (arguments.length) {
    case 1:
      return a;
    case 2:
      return ab(a);
    case 3:
      return bc(ab(a));
    case 4:
      return cd(bc(ab(a)));
    case 5:
      return de(cd(bc(ab(a))));
    case 6:
      return ef(de(cd(bc(ab(a)))));
    case 7:
      return fg(ef(de(cd(bc(ab(a))))));
    case 8:
      return gh(fg(ef(de(cd(bc(ab(a)))))));
    case 9:
      return hi(gh(fg(ef(de(cd(bc(ab(a))))))));
    default: {
      let ret2 = arguments[0];
      for (let i = 1;i < arguments.length; i++) {
        ret2 = arguments[i](ret2);
      }
      return ret2;
    }
  }
}
var isFunction = (input) => typeof input === "function", dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      if (arity(arguments)) {
        return body.apply(this, arguments);
      }
      return (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    case 4:
      return function(a, b, c, d) {
        if (arguments.length >= 4) {
          return body(a, b, c, d);
        }
        return function(self) {
          return body(self, a, b, c);
        };
      };
    case 5:
      return function(a, b, c, d, e) {
        if (arguments.length >= 5) {
          return body(a, b, c, d, e);
        }
        return function(self) {
          return body(self, a, b, c, d);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
}, identity = (a) => a, constant = (value) => () => value, constTrue, constFalse, constUndefined, constVoid;
var init_Function = __esm(() => {
  constTrue = /* @__PURE__ */ constant(true);
  constFalse = /* @__PURE__ */ constant(false);
  constUndefined = /* @__PURE__ */ constant(undefined);
  constVoid = constUndefined;
});

// node_modules/effect/dist/esm/Equivalence.js
var make = (isEquivalent) => (self, that) => self === that || isEquivalent(self, that), isStrictEquivalent = (x, y) => x === y, strict = () => isStrictEquivalent, number, mapInput, Date2, array = (item) => make((self, that) => {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    const isEq = item(self[i], that[i]);
    if (!isEq) {
      return false;
    }
  }
  return true;
});
var init_Equivalence = __esm(() => {
  init_Function();
  number = /* @__PURE__ */ strict();
  mapInput = /* @__PURE__ */ dual(2, (self, f) => make((x, y) => self(f(x), f(y))));
  Date2 = /* @__PURE__ */ mapInput(number, (date) => date.getTime());
});

// node_modules/effect/dist/esm/internal/doNotation.js
var let_ = (map) => dual(3, (self, name, f) => map(self, (a) => Object.assign({}, a, {
  [name]: f(a)
}))), bindTo = (map) => dual(2, (self, name) => map(self, (a) => ({
  [name]: a
}))), bind = (map, flatMap) => dual(3, (self, name, f) => flatMap(self, (a) => map(f(a), (b) => Object.assign({}, a, {
  [name]: b
}))));
var init_doNotation = __esm(() => {
  init_Function();
});

// node_modules/effect/dist/esm/internal/version.js
var moduleVersion = "3.14.1", getCurrentVersion = () => moduleVersion;

// node_modules/effect/dist/esm/GlobalValue.js
var globalStoreId, globalStore, globalValue = (id, compute) => {
  if (!globalStore) {
    globalThis[globalStoreId] ??= new Map;
    globalStore = globalThis[globalStoreId];
  }
  if (!globalStore.has(id)) {
    globalStore.set(id, compute());
  }
  return globalStore.get(id);
};
var init_GlobalValue = __esm(() => {
  globalStoreId = `effect/GlobalValue/globalStoreId/${/* @__PURE__ */ getCurrentVersion()}`;
});

// node_modules/effect/dist/esm/Predicate.js
var isString = (input) => typeof input === "string", isNumber = (input) => typeof input === "number", isBoolean = (input) => typeof input === "boolean", isBigInt = (input) => typeof input === "bigint", isSymbol = (input) => typeof input === "symbol", isFunction2, isUndefined = (input) => input === undefined, isNever = (_) => false, isRecordOrArray = (input) => typeof input === "object" && input !== null, isObject = (input) => isRecordOrArray(input) || isFunction2(input), hasProperty, isTagged, isNullable = (input) => input === null || input === undefined, isNotNullable = (input) => input !== null && input !== undefined, isDate = (input) => input instanceof Date, isIterable = (input) => hasProperty(input, Symbol.iterator), isRecord = (input) => isRecordOrArray(input) && !Array.isArray(input), isPromiseLike = (input) => hasProperty(input, "then") && isFunction2(input.then);
var init_Predicate = __esm(() => {
  init_Function();
  isFunction2 = isFunction;
  hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObject(self) && (property in self));
  isTagged = /* @__PURE__ */ dual(2, (self, tag) => hasProperty(self, "_tag") && self["_tag"] === tag);
});

// node_modules/effect/dist/esm/internal/errors.js
var getBugErrorMessage = (message) => `BUG: ${message} - please report an issue at https://github.com/Effect-TS/effect/issues`;

// node_modules/effect/dist/esm/Utils.js
class PCGRandom {
  _state;
  constructor(seedHi, seedLo, incHi, incLo) {
    if (isNullable(seedLo) && isNullable(seedHi)) {
      seedLo = Math.random() * 4294967295 >>> 0;
      seedHi = 0;
    } else if (isNullable(seedLo)) {
      seedLo = seedHi;
      seedHi = 0;
    }
    if (isNullable(incLo) && isNullable(incHi)) {
      incLo = this._state ? this._state[3] : defaultIncLo;
      incHi = this._state ? this._state[2] : defaultIncHi;
    } else if (isNullable(incLo)) {
      incLo = incHi;
      incHi = 0;
    }
    this._state = new Int32Array([0, 0, incHi >>> 0, ((incLo || 0) | 1) >>> 0]);
    this._next();
    add64(this._state, this._state[0], this._state[1], seedHi >>> 0, seedLo >>> 0);
    this._next();
    return this;
  }
  getState() {
    return [this._state[0], this._state[1], this._state[2], this._state[3]];
  }
  setState(state) {
    this._state[0] = state[0];
    this._state[1] = state[1];
    this._state[2] = state[2];
    this._state[3] = state[3] | 1;
  }
  integer(max) {
    return Math.round(this.number() * Number.MAX_SAFE_INTEGER) % max;
  }
  number() {
    const hi = (this._next() & 67108863) * 1;
    const lo = (this._next() & 134217727) * 1;
    return (hi * BIT_27 + lo) / BIT_53;
  }
  _next() {
    const oldHi = this._state[0] >>> 0;
    const oldLo = this._state[1] >>> 0;
    mul64(this._state, oldHi, oldLo, MUL_HI, MUL_LO);
    add64(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
    let xsHi = oldHi >>> 18;
    let xsLo = (oldLo >>> 18 | oldHi << 14) >>> 0;
    xsHi = (xsHi ^ oldHi) >>> 0;
    xsLo = (xsLo ^ oldLo) >>> 0;
    const xorshifted = (xsLo >>> 27 | xsHi << 5) >>> 0;
    const rot = oldHi >>> 27;
    const rot2 = (-rot >>> 0 & 31) >>> 0;
    return (xorshifted >>> rot | xorshifted << rot2) >>> 0;
  }
}
function mul64(out, aHi, aLo, bHi, bLo) {
  let c1 = (aLo >>> 16) * (bLo & 65535) >>> 0;
  let c0 = (aLo & 65535) * (bLo >>> 16) >>> 0;
  let lo = (aLo & 65535) * (bLo & 65535) >>> 0;
  let hi = (aLo >>> 16) * (bLo >>> 16) + ((c0 >>> 16) + (c1 >>> 16)) >>> 0;
  c0 = c0 << 16 >>> 0;
  lo = lo + c0 >>> 0;
  if (lo >>> 0 < c0 >>> 0) {
    hi = hi + 1 >>> 0;
  }
  c1 = c1 << 16 >>> 0;
  lo = lo + c1 >>> 0;
  if (lo >>> 0 < c1 >>> 0) {
    hi = hi + 1 >>> 0;
  }
  hi = hi + Math.imul(aLo, bHi) >>> 0;
  hi = hi + Math.imul(aHi, bLo) >>> 0;
  out[0] = hi;
  out[1] = lo;
}
function add64(out, aHi, aLo, bHi, bLo) {
  let hi = aHi + bHi >>> 0;
  const lo = aLo + bLo >>> 0;
  if (lo >>> 0 < aLo >>> 0) {
    hi = hi + 1 | 0;
  }
  out[0] = hi;
  out[1] = lo;
}
function yieldWrapGet(self) {
  if (typeof self === "object" && self !== null && YieldWrapTypeId in self) {
    return self[YieldWrapTypeId]();
  }
  throw new Error(getBugErrorMessage("yieldWrapGet"));
}
var SingleShotGen, defaultIncHi = 335903614, defaultIncLo = 4150755663, MUL_HI, MUL_LO, BIT_53 = 9007199254740992, BIT_27 = 134217728, YieldWrapTypeId, YieldWrap, structuralRegionState, tracingFunction = (name) => {
  const wrap = {
    [name](body) {
      return body();
    }
  };
  return function(fn) {
    return wrap[name](fn);
  };
}, internalCall, genConstructor, isGeneratorFunction = (u) => isObject(u) && u.constructor === genConstructor;
var init_Utils = __esm(() => {
  init_Function();
  init_GlobalValue();
  init_Predicate();
  SingleShotGen = class SingleShotGen {
    self;
    called = false;
    constructor(self) {
      this.self = self;
    }
    next(a) {
      return this.called ? {
        value: a,
        done: true
      } : (this.called = true, {
        value: this.self,
        done: false
      });
    }
    return(a) {
      return {
        value: a,
        done: true
      };
    }
    throw(e) {
      throw e;
    }
    [Symbol.iterator]() {
      return new SingleShotGen(this.self);
    }
  };
  MUL_HI = 1481765933 >>> 0;
  MUL_LO = 1284865837 >>> 0;
  YieldWrapTypeId = /* @__PURE__ */ Symbol.for("effect/Utils/YieldWrap");
  YieldWrap = class YieldWrap {
    #value;
    constructor(value) {
      this.#value = value;
    }
    [YieldWrapTypeId]() {
      return this.#value;
    }
  };
  structuralRegionState = /* @__PURE__ */ globalValue("effect/Utils/isStructuralRegion", () => ({
    enabled: false,
    tester: undefined
  }));
  internalCall = /* @__PURE__ */ tracingFunction("effect_internal_function");
  genConstructor = function* () {}.constructor;
});

// node_modules/effect/dist/esm/Hash.js
var randomHashCache, symbol, hash = (self) => {
  if (structuralRegionState.enabled === true) {
    return 0;
  }
  switch (typeof self) {
    case "number":
      return number2(self);
    case "bigint":
      return string(self.toString(10));
    case "boolean":
      return string(String(self));
    case "symbol":
      return string(String(self));
    case "string":
      return string(self);
    case "undefined":
      return string("undefined");
    case "function":
    case "object": {
      if (self === null) {
        return string("null");
      } else if (self instanceof Date) {
        return hash(self.toISOString());
      } else if (isHash(self)) {
        return self[symbol]();
      } else {
        return random(self);
      }
    }
    default:
      throw new Error(`BUG: unhandled typeof ${typeof self} - please report an issue at https://github.com/Effect-TS/effect/issues`);
  }
}, random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, number2(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
  }
  return randomHashCache.get(self);
}, combine = (b) => (self) => self * 53 ^ b, optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824, isHash = (u) => hasProperty(u, symbol), number2 = (n) => {
  if (n !== n || n === Infinity) {
    return 0;
  }
  let h = n | 0;
  if (h !== n) {
    h ^= n * 4294967295;
  }
  while (n > 4294967295) {
    h ^= n /= 4294967295;
  }
  return optimize(h);
}, string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
}, structureKeys = (o, keys) => {
  let h = 12289;
  for (let i = 0;i < keys.length; i++) {
    h ^= pipe(string(keys[i]), combine(hash(o[keys[i]])));
  }
  return optimize(h);
}, structure = (o) => structureKeys(o, Object.keys(o)), array2 = (arr) => {
  let h = 6151;
  for (let i = 0;i < arr.length; i++) {
    h = pipe(h, combine(hash(arr[i])));
  }
  return optimize(h);
}, cached = function() {
  if (arguments.length === 1) {
    const self2 = arguments[0];
    return function(hash3) {
      Object.defineProperty(self2, symbol, {
        value() {
          return hash3;
        },
        enumerable: false
      });
      return hash3;
    };
  }
  const self = arguments[0];
  const hash2 = arguments[1];
  Object.defineProperty(self, symbol, {
    value() {
      return hash2;
    },
    enumerable: false
  });
  return hash2;
};
var init_Hash = __esm(() => {
  init_Function();
  init_GlobalValue();
  init_Predicate();
  init_Utils();
  randomHashCache = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Hash/randomHashCache"), () => new WeakMap);
  symbol = /* @__PURE__ */ Symbol.for("effect/Hash");
});

// node_modules/effect/dist/esm/Equal.js
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that) {
    return true;
  }
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "object" || selfType === "function") {
    if (self !== null && that !== null) {
      if (isEqual(self) && isEqual(that)) {
        if (hash(self) === hash(that) && self[symbol2](that)) {
          return true;
        } else {
          return structuralRegionState.enabled && structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
        }
      } else if (self instanceof Date && that instanceof Date) {
        return self.toISOString() === that.toISOString();
      }
    }
    if (structuralRegionState.enabled) {
      if (Array.isArray(self) && Array.isArray(that)) {
        return self.length === that.length && self.every((v, i) => compareBoth(v, that[i]));
      }
      if (Object.getPrototypeOf(self) === Object.prototype && Object.getPrototypeOf(self) === Object.prototype) {
        const keysSelf = Object.keys(self);
        const keysThat = Object.keys(that);
        if (keysSelf.length === keysThat.length) {
          for (const key of keysSelf) {
            if (!((key in that) && compareBoth(self[key], that[key]))) {
              return structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
            }
          }
          return true;
        }
      }
      return structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
    }
  }
  return structuralRegionState.enabled && structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
}
var symbol2, isEqual = (u) => hasProperty(u, symbol2), equivalence = () => equals;
var init_Equal = __esm(() => {
  init_Hash();
  init_Predicate();
  init_Utils();
  symbol2 = /* @__PURE__ */ Symbol.for("effect/Equal");
});

// node_modules/effect/dist/esm/Inspectable.js
var NodeInspectSymbol, toJSON = (x) => {
  try {
    if (hasProperty(x, "toJSON") && isFunction2(x["toJSON"]) && x["toJSON"].length === 0) {
      return x.toJSON();
    } else if (Array.isArray(x)) {
      return x.map(toJSON);
    }
  } catch (_) {
    return {};
  }
  return redact(x);
}, format = (x) => JSON.stringify(x, null, 2), BaseProto, toStringUnknown = (u, whitespace = 2) => {
  if (typeof u === "string") {
    return u;
  }
  try {
    return typeof u === "object" ? stringifyCircular(u, whitespace) : String(u);
  } catch (_) {
    return String(u);
  }
}, stringifyCircular = (obj, whitespace) => {
  let cache = [];
  const retVal = JSON.stringify(obj, (_key, value) => typeof value === "object" && value !== null ? cache.includes(value) ? undefined : cache.push(value) && (redactableState.fiberRefs !== undefined && isRedactable(value) ? value[symbolRedactable](redactableState.fiberRefs) : value) : value, whitespace);
  cache = undefined;
  return retVal;
}, symbolRedactable, isRedactable = (u) => typeof u === "object" && u !== null && (symbolRedactable in u), redactableState, withRedactableContext = (context, f) => {
  const prev = redactableState.fiberRefs;
  redactableState.fiberRefs = context;
  try {
    return f();
  } finally {
    redactableState.fiberRefs = prev;
  }
}, redact = (u) => {
  if (isRedactable(u) && redactableState.fiberRefs !== undefined) {
    return u[symbolRedactable](redactableState.fiberRefs);
  }
  return u;
};
var init_Inspectable = __esm(() => {
  init_GlobalValue();
  init_Predicate();
  NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
  BaseProto = {
    toJSON() {
      return toJSON(this);
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    toString() {
      return format(this.toJSON());
    }
  };
  symbolRedactable = /* @__PURE__ */ Symbol.for("effect/Inspectable/Redactable");
  redactableState = /* @__PURE__ */ globalValue("effect/Inspectable/redactableState", () => ({
    fiberRefs: undefined
  }));
});

// node_modules/effect/dist/esm/Pipeable.js
var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret2 = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret2 = args[i](ret2);
      }
      return ret2;
    }
  }
};

// node_modules/effect/dist/esm/internal/opCodes/effect.js
var OP_ASYNC = "Async", OP_COMMIT = "Commit", OP_FAILURE = "Failure", OP_ON_FAILURE = "OnFailure", OP_ON_SUCCESS = "OnSuccess", OP_ON_SUCCESS_AND_FAILURE = "OnSuccessAndFailure", OP_SUCCESS = "Success", OP_SYNC = "Sync", OP_TAG = "Tag", OP_UPDATE_RUNTIME_FLAGS = "UpdateRuntimeFlags", OP_WHILE = "While", OP_ITERATOR = "Iterator", OP_WITH_RUNTIME = "WithRuntime", OP_YIELD = "Yield", OP_REVERT_FLAGS = "RevertFlags";

// node_modules/effect/dist/esm/internal/effectable.js
var EffectTypeId, StreamTypeId, SinkTypeId, ChannelTypeId, effectVariance, sinkVariance, channelVariance, EffectPrototype, StructuralPrototype, CommitPrototype, StructuralCommitPrototype, Base;
var init_effectable = __esm(() => {
  init_Equal();
  init_Hash();
  init_Utils();
  EffectTypeId = /* @__PURE__ */ Symbol.for("effect/Effect");
  StreamTypeId = /* @__PURE__ */ Symbol.for("effect/Stream");
  SinkTypeId = /* @__PURE__ */ Symbol.for("effect/Sink");
  ChannelTypeId = /* @__PURE__ */ Symbol.for("effect/Channel");
  effectVariance = {
    _R: (_) => _,
    _E: (_) => _,
    _A: (_) => _,
    _V: /* @__PURE__ */ getCurrentVersion()
  };
  sinkVariance = {
    _A: (_) => _,
    _In: (_) => _,
    _L: (_) => _,
    _E: (_) => _,
    _R: (_) => _
  };
  channelVariance = {
    _Env: (_) => _,
    _InErr: (_) => _,
    _InElem: (_) => _,
    _InDone: (_) => _,
    _OutErr: (_) => _,
    _OutElem: (_) => _,
    _OutDone: (_) => _
  };
  EffectPrototype = {
    [EffectTypeId]: effectVariance,
    [StreamTypeId]: effectVariance,
    [SinkTypeId]: sinkVariance,
    [ChannelTypeId]: channelVariance,
    [symbol2](that) {
      return this === that;
    },
    [symbol]() {
      return cached(this, random(this));
    },
    [Symbol.iterator]() {
      return new SingleShotGen(new YieldWrap(this));
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  StructuralPrototype = {
    [symbol]() {
      return cached(this, structure(this));
    },
    [symbol2](that) {
      const selfKeys = Object.keys(this);
      const thatKeys = Object.keys(that);
      if (selfKeys.length !== thatKeys.length) {
        return false;
      }
      for (const key of selfKeys) {
        if (!((key in that) && equals(this[key], that[key]))) {
          return false;
        }
      }
      return true;
    }
  };
  CommitPrototype = {
    ...EffectPrototype,
    _op: OP_COMMIT
  };
  StructuralCommitPrototype = {
    ...CommitPrototype,
    ...StructuralPrototype
  };
  Base = /* @__PURE__ */ function() {
    function Base2() {}
    Base2.prototype = CommitPrototype;
    return Base2;
  }();
});

// node_modules/effect/dist/esm/internal/option.js
var TypeId, CommonProto, SomeProto, NoneHash, NoneProto, isOption = (input) => hasProperty(input, TypeId), isNone = (fa) => fa._tag === "None", isSome = (fa) => fa._tag === "Some", none, some = (value) => {
  const a = Object.create(SomeProto);
  a.value = value;
  return a;
};
var init_option = __esm(() => {
  init_Equal();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_effectable();
  TypeId = /* @__PURE__ */ Symbol.for("effect/Option");
  CommonProto = {
    ...EffectPrototype,
    [TypeId]: {
      _A: (_) => _
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    toString() {
      return format(this.toJSON());
    }
  };
  SomeProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
    _tag: "Some",
    _op: "Some",
    [symbol2](that) {
      return isOption(that) && isSome(that) && equals(this.value, that.value);
    },
    [symbol]() {
      return cached(this, combine(hash(this._tag))(hash(this.value)));
    },
    toJSON() {
      return {
        _id: "Option",
        _tag: this._tag,
        value: toJSON(this.value)
      };
    }
  });
  NoneHash = /* @__PURE__ */ hash("None");
  NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
    _tag: "None",
    _op: "None",
    [symbol2](that) {
      return isOption(that) && isNone(that);
    },
    [symbol]() {
      return NoneHash;
    },
    toJSON() {
      return {
        _id: "Option",
        _tag: this._tag
      };
    }
  });
  none = /* @__PURE__ */ Object.create(NoneProto);
});

// node_modules/effect/dist/esm/internal/either.js
var TypeId2, CommonProto2, RightProto, LeftProto, isEither = (input) => hasProperty(input, TypeId2), isLeft = (ma) => ma._tag === "Left", isRight = (ma) => ma._tag === "Right", left = (left2) => {
  const a = Object.create(LeftProto);
  a.left = left2;
  return a;
}, right = (right2) => {
  const a = Object.create(RightProto);
  a.right = right2;
  return a;
};
var init_either = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_effectable();
  init_option();
  TypeId2 = /* @__PURE__ */ Symbol.for("effect/Either");
  CommonProto2 = {
    ...EffectPrototype,
    [TypeId2]: {
      _R: (_) => _
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    toString() {
      return format(this.toJSON());
    }
  };
  RightProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
    _tag: "Right",
    _op: "Right",
    [symbol2](that) {
      return isEither(that) && isRight(that) && equals(this.right, that.right);
    },
    [symbol]() {
      return combine(hash(this._tag))(hash(this.right));
    },
    toJSON() {
      return {
        _id: "Either",
        _tag: this._tag,
        right: toJSON(this.right)
      };
    }
  });
  LeftProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
    _tag: "Left",
    _op: "Left",
    [symbol2](that) {
      return isEither(that) && isLeft(that) && equals(this.left, that.left);
    },
    [symbol]() {
      return combine(hash(this._tag))(hash(this.left));
    },
    toJSON() {
      return {
        _id: "Either",
        _tag: this._tag,
        left: toJSON(this.left)
      };
    }
  });
});

// node_modules/effect/dist/esm/Either.js
var right2, left2, isEither2, isLeft2, isRight2, mapLeft, map, match, merge, getOrThrowWith, getOrThrow;
var init_Either = __esm(() => {
  init_Equivalence();
  init_Function();
  init_doNotation();
  init_either();
  init_option();
  init_Predicate();
  init_Utils();
  right2 = right;
  left2 = left;
  isEither2 = isEither;
  isLeft2 = isLeft;
  isRight2 = isRight;
  mapLeft = /* @__PURE__ */ dual(2, (self, f) => isLeft2(self) ? left2(f(self.left)) : right2(self.right));
  map = /* @__PURE__ */ dual(2, (self, f) => isRight2(self) ? right2(f(self.right)) : left2(self.left));
  match = /* @__PURE__ */ dual(2, (self, {
    onLeft,
    onRight
  }) => isLeft2(self) ? onLeft(self.left) : onRight(self.right));
  merge = /* @__PURE__ */ match({
    onLeft: identity,
    onRight: identity
  });
  getOrThrowWith = /* @__PURE__ */ dual(2, (self, onLeft) => {
    if (isRight2(self)) {
      return self.right;
    }
    throw onLeft(self.left);
  });
  getOrThrow = /* @__PURE__ */ getOrThrowWith(() => new Error("getOrThrow called on a Left"));
});

// node_modules/effect/dist/esm/internal/array.js
var isNonEmptyArray = (self) => self.length > 0;

// node_modules/effect/dist/esm/Order.js
var make2 = (compare) => (self, that) => self === that ? 0 : compare(self, that), number3, mapInput2, greaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var init_Order = __esm(() => {
  init_Function();
  number3 = /* @__PURE__ */ make2((self, that) => self < that ? -1 : 1);
  mapInput2 = /* @__PURE__ */ dual(2, (self, f) => make2((b1, b2) => self(f(b1), f(b2))));
});

// node_modules/effect/dist/esm/Option.js
var none2 = () => none, some2, isNone2, isSome2, match2, getOrElse, orElse, orElseSome, fromNullable = (nullableValue) => nullableValue == null ? none2() : some2(nullableValue), getOrUndefined, liftThrowable = (f) => (...a) => {
  try {
    return some2(f(...a));
  } catch (e) {
    return none2();
  }
}, getOrThrowWith2, getOrThrow2, map2, flatMap, flatMapNullable, containsWith = (isEquivalent) => dual(2, (self, a) => isNone2(self) ? false : isEquivalent(self.value, a)), _equivalence, contains, exists, mergeWith = (f) => (o1, o2) => {
  if (isNone2(o1)) {
    return o2;
  } else if (isNone2(o2)) {
    return o1;
  }
  return some2(f(o1.value, o2.value));
};
var init_Option = __esm(() => {
  init_Equal();
  init_Equivalence();
  init_Function();
  init_doNotation();
  init_either();
  init_option();
  init_Order();
  init_Utils();
  some2 = some;
  isNone2 = isNone;
  isSome2 = isSome;
  match2 = /* @__PURE__ */ dual(2, (self, {
    onNone,
    onSome
  }) => isNone2(self) ? onNone() : onSome(self.value));
  getOrElse = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? onNone() : self.value);
  orElse = /* @__PURE__ */ dual(2, (self, that) => isNone2(self) ? that() : self);
  orElseSome = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? some2(onNone()) : self);
  getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);
  getOrThrowWith2 = /* @__PURE__ */ dual(2, (self, onNone) => {
    if (isSome2(self)) {
      return self.value;
    }
    throw onNone();
  });
  getOrThrow2 = /* @__PURE__ */ getOrThrowWith2(() => new Error("getOrThrow called on a None"));
  map2 = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : some2(f(self.value)));
  flatMap = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : f(self.value));
  flatMapNullable = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : fromNullable(f(self.value)));
  _equivalence = /* @__PURE__ */ equivalence();
  contains = /* @__PURE__ */ containsWith(_equivalence);
  exists = /* @__PURE__ */ dual(2, (self, refinement) => isNone2(self) ? false : refinement(self.value));
});

// node_modules/effect/dist/esm/Tuple.js
var make3 = (...elements) => elements;
var init_Tuple = __esm(() => {
  init_Equivalence();
  init_Function();
  init_Order();
  init_Predicate();
});

// node_modules/effect/dist/esm/Iterable.js
var unsafeHead = (self) => {
  const iterator = self[Symbol.iterator]();
  const result = iterator.next();
  if (result.done)
    throw new Error("unsafeHead: empty iterable");
  return result.value;
}, constEmpty, constEmptyIterator, empty = () => constEmpty;
var init_Iterable = __esm(() => {
  init_Either();
  init_Equal();
  init_Function();
  init_Option();
  init_Predicate();
  init_Tuple();
  constEmpty = {
    [Symbol.iterator]() {
      return constEmptyIterator;
    }
  };
  constEmptyIterator = {
    next() {
      return {
        done: true,
        value: undefined
      };
    }
  };
});

// node_modules/effect/dist/esm/Record.js
var init_Record = __esm(() => {
  init_Either();
  init_Equal();
  init_Function();
  init_Option();
});

// node_modules/effect/dist/esm/Array.js
var allocate = (n) => new Array(n), makeBy, fromIterable = (collection) => Array.isArray(collection) ? collection : Array.from(collection), ensure = (self) => Array.isArray(self) ? self : [self], matchLeft, prepend, append, appendAll, isArray, isEmptyArray = (self) => self.length === 0, isEmptyReadonlyArray, isNonEmptyArray2, isNonEmptyReadonlyArray, isOutOfBounds = (i, as) => i < 0 || i >= as.length, clamp = (i, as) => Math.floor(Math.min(Math.max(0, i), as.length)), get, unsafeGet, head, headNonEmpty, last = (self) => isNonEmptyReadonlyArray(self) ? some2(lastNonEmpty(self)) : none2(), lastNonEmpty = (self) => self[self.length - 1], tailNonEmpty = (self) => self.slice(1), spanIndex = (self, predicate) => {
  let i = 0;
  for (const a of self) {
    if (!predicate(a, i)) {
      break;
    }
    i++;
  }
  return i;
}, span, drop, reverse = (self) => Array.from(self).reverse(), sort, zip, zipWith, _equivalence2, splitAt, splitNonEmptyAt, copy = (self) => self.slice(), unionWith, union, empty2 = () => [], of = (a) => [a], map3, flatMap2, flatten, filterMap, partitionMap, getSomes, reduce, reduceRight, every, unfold = (b, f) => {
  const out = [];
  let next = b;
  let o;
  while (isSome2(o = f(next))) {
    const [a, b2] = o.value;
    out.push(a);
    next = b2;
  }
  return out;
}, getEquivalence, dedupeWith, dedupe = (self) => dedupeWith(self, equivalence()), join;
var init_Array = __esm(() => {
  init_Either();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_doNotation();
  init_Iterable();
  init_Option();
  init_Order();
  init_Predicate();
  init_Record();
  init_Tuple();
  makeBy = /* @__PURE__ */ dual(2, (n, f) => {
    const max2 = Math.max(1, Math.floor(n));
    const out = new Array(max2);
    for (let i = 0;i < max2; i++) {
      out[i] = f(i);
    }
    return out;
  });
  matchLeft = /* @__PURE__ */ dual(2, (self, {
    onEmpty,
    onNonEmpty
  }) => isNonEmptyReadonlyArray(self) ? onNonEmpty(headNonEmpty(self), tailNonEmpty(self)) : onEmpty());
  prepend = /* @__PURE__ */ dual(2, (self, head) => [head, ...self]);
  append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
  appendAll = /* @__PURE__ */ dual(2, (self, that) => fromIterable(self).concat(fromIterable(that)));
  isArray = Array.isArray;
  isEmptyReadonlyArray = isEmptyArray;
  isNonEmptyArray2 = isNonEmptyArray;
  isNonEmptyReadonlyArray = isNonEmptyArray;
  get = /* @__PURE__ */ dual(2, (self, index) => {
    const i = Math.floor(index);
    return isOutOfBounds(i, self) ? none2() : some2(self[i]);
  });
  unsafeGet = /* @__PURE__ */ dual(2, (self, index) => {
    const i = Math.floor(index);
    if (isOutOfBounds(i, self)) {
      throw new Error(`Index ${i} out of bounds`);
    }
    return self[i];
  });
  head = /* @__PURE__ */ get(0);
  headNonEmpty = /* @__PURE__ */ unsafeGet(0);
  span = /* @__PURE__ */ dual(2, (self, predicate) => splitAt(self, spanIndex(self, predicate)));
  drop = /* @__PURE__ */ dual(2, (self, n) => {
    const input = fromIterable(self);
    return input.slice(clamp(n, input), input.length);
  });
  sort = /* @__PURE__ */ dual(2, (self, O) => {
    const out = Array.from(self);
    out.sort(O);
    return out;
  });
  zip = /* @__PURE__ */ dual(2, (self, that) => zipWith(self, that, make3));
  zipWith = /* @__PURE__ */ dual(3, (self, that, f) => {
    const as = fromIterable(self);
    const bs = fromIterable(that);
    if (isNonEmptyReadonlyArray(as) && isNonEmptyReadonlyArray(bs)) {
      const out = [f(headNonEmpty(as), headNonEmpty(bs))];
      const len = Math.min(as.length, bs.length);
      for (let i = 1;i < len; i++) {
        out[i] = f(as[i], bs[i]);
      }
      return out;
    }
    return [];
  });
  _equivalence2 = /* @__PURE__ */ equivalence();
  splitAt = /* @__PURE__ */ dual(2, (self, n) => {
    const input = Array.from(self);
    const _n = Math.floor(n);
    if (isNonEmptyReadonlyArray(input)) {
      if (_n >= 1) {
        return splitNonEmptyAt(input, _n);
      }
      return [[], input];
    }
    return [input, []];
  });
  splitNonEmptyAt = /* @__PURE__ */ dual(2, (self, n) => {
    const _n = Math.max(1, Math.floor(n));
    return _n >= self.length ? [copy(self), []] : [prepend(self.slice(1, _n), headNonEmpty(self)), self.slice(_n)];
  });
  unionWith = /* @__PURE__ */ dual(3, (self, that, isEquivalent) => {
    const a = fromIterable(self);
    const b = fromIterable(that);
    if (isNonEmptyReadonlyArray(a)) {
      if (isNonEmptyReadonlyArray(b)) {
        const dedupe = dedupeWith(isEquivalent);
        return dedupe(appendAll(a, b));
      }
      return a;
    }
    return b;
  });
  union = /* @__PURE__ */ dual(2, (self, that) => unionWith(self, that, _equivalence2));
  map3 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));
  flatMap2 = /* @__PURE__ */ dual(2, (self, f) => {
    if (isEmptyReadonlyArray(self)) {
      return [];
    }
    const out = [];
    for (let i = 0;i < self.length; i++) {
      const inner = f(self[i], i);
      for (let j = 0;j < inner.length; j++) {
        out.push(inner[j]);
      }
    }
    return out;
  });
  flatten = /* @__PURE__ */ flatMap2(identity);
  filterMap = /* @__PURE__ */ dual(2, (self, f) => {
    const as = fromIterable(self);
    const out = [];
    for (let i = 0;i < as.length; i++) {
      const o = f(as[i], i);
      if (isSome2(o)) {
        out.push(o.value);
      }
    }
    return out;
  });
  partitionMap = /* @__PURE__ */ dual(2, (self, f) => {
    const left3 = [];
    const right3 = [];
    const as = fromIterable(self);
    for (let i = 0;i < as.length; i++) {
      const e = f(as[i], i);
      if (isLeft2(e)) {
        left3.push(e.left);
      } else {
        right3.push(e.right);
      }
    }
    return [left3, right3];
  });
  getSomes = /* @__PURE__ */ filterMap(identity);
  reduce = /* @__PURE__ */ dual(3, (self, b, f) => fromIterable(self).reduce((b2, a, i) => f(b2, a, i), b));
  reduceRight = /* @__PURE__ */ dual(3, (self, b, f) => fromIterable(self).reduceRight((b2, a, i) => f(b2, a, i), b));
  every = /* @__PURE__ */ dual(2, (self, refinement) => self.every(refinement));
  getEquivalence = array;
  dedupeWith = /* @__PURE__ */ dual(2, (self, isEquivalent) => {
    const input = fromIterable(self);
    if (isNonEmptyReadonlyArray(input)) {
      const out = [headNonEmpty(input)];
      const rest = tailNonEmpty(input);
      for (const r of rest) {
        if (out.every((a) => !isEquivalent(r, a))) {
          out.push(r);
        }
      }
      return out;
    }
    return [];
  });
  join = /* @__PURE__ */ dual(2, (self, sep) => fromIterable(self).join(sep));
});

// node_modules/fast-check/lib/esm/fast-check-default.js
var init_fast_check_default = () => {};

// node_modules/fast-check/lib/esm/fast-check.js
var init_fast_check = __esm(() => {
  init_fast_check_default();
});

// node_modules/effect/dist/esm/FastCheck.js
var init_FastCheck = __esm(() => {
  init_fast_check();
});

// node_modules/effect/dist/esm/internal/schema/util.js
var getKeysForIndexSignature = (input, parameter) => {
  switch (parameter._tag) {
    case "StringKeyword":
    case "TemplateLiteral":
      return Object.keys(input);
    case "SymbolKeyword":
      return Object.getOwnPropertySymbols(input);
    case "Refinement":
      return getKeysForIndexSignature(input, parameter.from);
  }
}, ownKeys = (o) => Object.keys(o).concat(Object.getOwnPropertySymbols(o)), memoizeThunk = (f) => {
  let done = false;
  let a;
  return () => {
    if (done) {
      return a;
    }
    a = f();
    done = true;
    return a;
  };
}, formatDate = (date) => {
  try {
    return date.toISOString();
  } catch (e) {
    return String(date);
  }
}, formatUnknown = (u, checkCircular = true) => {
  if (Array.isArray(u)) {
    return `[${u.map((i) => formatUnknown(i, checkCircular)).join(",")}]`;
  }
  if (isDate(u)) {
    return formatDate(u);
  }
  if (hasProperty(u, "toString") && isFunction2(u["toString"]) && u["toString"] !== Object.prototype.toString) {
    return u["toString"]();
  }
  if (isString(u)) {
    return JSON.stringify(u);
  }
  if (isNumber(u) || u == null || isBoolean(u) || isSymbol(u)) {
    return String(u);
  }
  if (isBigInt(u)) {
    return String(u) + "n";
  }
  if (isIterable(u)) {
    return `${u.constructor.name}(${formatUnknown(Array.from(u), checkCircular)})`;
  }
  try {
    if (checkCircular) {
      JSON.stringify(u);
    }
    const pojo = `{${ownKeys(u).map((k) => `${isString(k) ? JSON.stringify(k) : String(k)}:${formatUnknown(u[k], false)}`).join(",")}}`;
    const name = u.constructor.name;
    return u.constructor !== Object.prototype.constructor ? `${name}(${pojo})` : pojo;
  } catch (e) {
    return "<circular structure>";
  }
}, formatPropertyKey = (name) => typeof name === "string" ? JSON.stringify(name) : String(name), isNonEmpty = (x) => Array.isArray(x), isSingle = (x) => !Array.isArray(x), formatPathKey = (key) => `[${formatPropertyKey(key)}]`, formatPath = (path) => isNonEmpty(path) ? path.map(formatPathKey).join("") : formatPathKey(path);
var init_util = __esm(() => {
  init_Predicate();
});

// node_modules/effect/dist/esm/internal/schema/errors.js
var getErrorMessage = (reason, details, path, ast) => {
  let out = reason;
  if (path && isNonEmptyReadonlyArray(path)) {
    out += `
at path: ${formatPath(path)}`;
  }
  if (details !== undefined) {
    out += `
details: ${details}`;
  }
  if (ast) {
    out += `
schema (${ast._tag}): ${ast}`;
  }
  return out;
}, getASTDuplicateIndexSignatureErrorMessage = (type) => getErrorMessage("Duplicate index signature", `${type} index signature`), getASTIndexSignatureParameterErrorMessage, getASTRequiredElementFollowinAnOptionalElementErrorMessage, getASTDuplicatePropertySignatureErrorMessage = (key) => getErrorMessage("Duplicate property signature", `Duplicate key ${formatUnknown(key)}`);
var init_errors = __esm(() => {
  init_Array();
  init_util();
  getASTIndexSignatureParameterErrorMessage = /* @__PURE__ */ getErrorMessage("Unsupported index signature parameter", "An index signature parameter type must be `string`, `symbol`, a template literal type or a refinement of the previous types");
  getASTRequiredElementFollowinAnOptionalElementErrorMessage = /* @__PURE__ */ getErrorMessage("Invalid element", "A required element cannot follow an optional element. ts(1257)");
});

// node_modules/effect/dist/esm/internal/schema/schemaId.js
var DateFromSelfSchemaId;
var init_schemaId = __esm(() => {
  DateFromSelfSchemaId = /* @__PURE__ */ Symbol.for("effect/SchemaId/DateFromSelf");
});

// node_modules/effect/dist/esm/Number.js
var Order;
var init_Number = __esm(() => {
  init_Equivalence();
  init_Function();
  init_option();
  init_Order();
  init_Predicate();
  Order = number3;
});

// node_modules/effect/dist/esm/RegExp.js
var escape = (string2) => string2.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
var init_RegExp = __esm(() => {
  init_Predicate();
});

// node_modules/effect/dist/esm/SchemaAST.js
class Declaration {
  typeParameters;
  decodeUnknown;
  encodeUnknown;
  annotations;
  _tag = "Declaration";
  constructor(typeParameters, decodeUnknown, encodeUnknown, annotations = {}) {
    this.typeParameters = typeParameters;
    this.decodeUnknown = decodeUnknown;
    this.encodeUnknown = encodeUnknown;
    this.annotations = annotations;
  }
  toString() {
    return getOrElse(getExpected(this), () => "<declaration schema>");
  }
  toJSON() {
    return {
      _tag: this._tag,
      typeParameters: this.typeParameters.map((ast) => ast.toJSON()),
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class Literal {
  literal;
  annotations;
  _tag = "Literal";
  constructor(literal, annotations = {}) {
    this.literal = literal;
    this.annotations = annotations;
  }
  toString() {
    return getOrElse(getExpected(this), () => formatUnknown(this.literal));
  }
  toJSON() {
    return {
      _tag: this._tag,
      literal: isBigInt(this.literal) ? String(this.literal) : this.literal,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class UniqueSymbol {
  symbol;
  annotations;
  _tag = "UniqueSymbol";
  constructor(symbol3, annotations = {}) {
    this.symbol = symbol3;
    this.annotations = annotations;
  }
  toString() {
    return getOrElse(getExpected(this), () => formatUnknown(this.symbol));
  }
  toJSON() {
    return {
      _tag: this._tag,
      symbol: String(this.symbol),
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class UndefinedKeyword {
  annotations;
  _tag = "UndefinedKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class VoidKeyword {
  annotations;
  _tag = "VoidKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class NeverKeyword {
  annotations;
  _tag = "NeverKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class UnknownKeyword {
  annotations;
  _tag = "UnknownKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class AnyKeyword {
  annotations;
  _tag = "AnyKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class StringKeyword {
  annotations;
  _tag = "StringKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class NumberKeyword {
  annotations;
  _tag = "NumberKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class BooleanKeyword {
  annotations;
  _tag = "BooleanKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class BigIntKeyword {
  annotations;
  _tag = "BigIntKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class SymbolKeyword {
  annotations;
  _tag = "SymbolKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class ObjectKeyword {
  annotations;
  _tag = "ObjectKeyword";
  constructor(annotations = {}) {
    this.annotations = annotations;
  }
  toString() {
    return formatKeyword(this);
  }
  toJSON() {
    return {
      _tag: this._tag,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class Type {
  type;
  annotations;
  constructor(type, annotations = {}) {
    this.type = type;
    this.annotations = annotations;
  }
  toJSON() {
    return {
      type: this.type.toJSON(),
      annotations: toJSONAnnotations(this.annotations)
    };
  }
  toString() {
    return String(this.type);
  }
}

class TupleType {
  elements;
  rest;
  isReadonly;
  annotations;
  _tag = "TupleType";
  constructor(elements, rest, isReadonly, annotations = {}) {
    this.elements = elements;
    this.rest = rest;
    this.isReadonly = isReadonly;
    this.annotations = annotations;
    let hasOptionalElement = false;
    let hasIllegalRequiredElement = false;
    for (const e of elements) {
      if (e.isOptional) {
        hasOptionalElement = true;
      } else if (hasOptionalElement) {
        hasIllegalRequiredElement = true;
        break;
      }
    }
    if (hasIllegalRequiredElement || hasOptionalElement && rest.length > 1) {
      throw new Error(getASTRequiredElementFollowinAnOptionalElementErrorMessage);
    }
  }
  toString() {
    return getOrElse(getExpected(this), () => formatTuple(this));
  }
  toJSON() {
    return {
      _tag: this._tag,
      elements: this.elements.map((e) => e.toJSON()),
      rest: this.rest.map((ast) => ast.toJSON()),
      isReadonly: this.isReadonly,
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class IndexSignature {
  type;
  isReadonly;
  parameter;
  constructor(parameter, type, isReadonly) {
    this.type = type;
    this.isReadonly = isReadonly;
    if (isParameter(parameter)) {
      this.parameter = parameter;
    } else {
      throw new Error(getASTIndexSignatureParameterErrorMessage);
    }
  }
  toString() {
    return (this.isReadonly ? "readonly " : "") + `[x: ${this.parameter}]: ${this.type}`;
  }
  toJSON() {
    return {
      parameter: this.parameter.toJSON(),
      type: this.type.toJSON(),
      isReadonly: this.isReadonly
    };
  }
}

class TypeLiteral {
  annotations;
  _tag = "TypeLiteral";
  propertySignatures;
  indexSignatures;
  constructor(propertySignatures, indexSignatures, annotations = {}) {
    this.annotations = annotations;
    const keys = {};
    for (let i = 0;i < propertySignatures.length; i++) {
      const name = propertySignatures[i].name;
      if (Object.prototype.hasOwnProperty.call(keys, name)) {
        throw new Error(getASTDuplicatePropertySignatureErrorMessage(name));
      }
      keys[name] = null;
    }
    const parameters = {
      string: false,
      symbol: false
    };
    for (let i = 0;i < indexSignatures.length; i++) {
      const encodedParameter = getEncodedParameter(indexSignatures[i].parameter);
      if (isStringKeyword(encodedParameter)) {
        if (parameters.string) {
          throw new Error(getASTDuplicateIndexSignatureErrorMessage("string"));
        }
        parameters.string = true;
      } else if (isSymbolKeyword(encodedParameter)) {
        if (parameters.symbol) {
          throw new Error(getASTDuplicateIndexSignatureErrorMessage("symbol"));
        }
        parameters.symbol = true;
      }
    }
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
  }
  toString() {
    return getOrElse(getExpected(this), () => formatTypeLiteral(this));
  }
  toJSON() {
    return {
      _tag: this._tag,
      propertySignatures: this.propertySignatures.map((ps) => ps.toJSON()),
      indexSignatures: this.indexSignatures.map((ps) => ps.toJSON()),
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class Union {
  types;
  annotations;
  static make = (types, annotations) => {
    return isMembers(types) ? new Union(types, annotations) : types.length === 1 ? types[0] : neverKeyword;
  };
  static unify = (candidates, annotations) => {
    return Union.make(unify(flatten2(candidates)), annotations);
  };
  _tag = "Union";
  constructor(types, annotations = {}) {
    this.types = types;
    this.annotations = annotations;
  }
  toString() {
    return getOrElse(getExpected(this), () => this.types.map(String).join(" | "));
  }
  toJSON() {
    return {
      _tag: this._tag,
      types: this.types.map((ast) => ast.toJSON()),
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}

class Suspend {
  f;
  annotations;
  _tag = "Suspend";
  constructor(f, annotations = {}) {
    this.f = f;
    this.annotations = annotations;
    this.f = memoizeThunk(f);
  }
  toString() {
    return getExpected(this).pipe(orElse(() => flatMap(liftThrowable(this.f)(), (ast) => getExpected(ast))), getOrElse(() => "<suspended schema>"));
  }
  toJSON() {
    const ast = this.f();
    let out = toJSONMemoMap.get(ast);
    if (out) {
      return out;
    }
    toJSONMemoMap.set(ast, {
      _tag: this._tag
    });
    out = {
      _tag: this._tag,
      ast: ast.toJSON(),
      annotations: toJSONAnnotations(this.annotations)
    };
    toJSONMemoMap.set(ast, out);
    return out;
  }
}

class Refinement {
  from;
  filter;
  annotations;
  _tag = "Refinement";
  constructor(from, filter, annotations = {}) {
    this.from = from;
    this.filter = filter;
    this.annotations = annotations;
  }
  toString() {
    return getIdentifierAnnotation(this).pipe(getOrElse(() => match2(getOrElseExpected(this), {
      onNone: () => `{ ${this.from} | filter }`,
      onSome: (expected) => isRefinement(this.from) ? String(this.from) + " & " + expected : expected
    })));
  }
  toJSON() {
    return {
      _tag: this._tag,
      from: this.from.toJSON(),
      annotations: toJSONAnnotations(this.annotations)
    };
  }
}
function changeMap(as, f) {
  let changed = false;
  const out = allocate(as.length);
  for (let i = 0;i < as.length; i++) {
    const a = as[i];
    const fa = f(a);
    if (fa !== a) {
      changed = true;
    }
    out[i] = fa;
  }
  return changed ? out : as;
}
function getBrands(ast) {
  return match2(getBrandAnnotation(ast), {
    onNone: () => "",
    onSome: (brands) => brands.map((brand) => ` & Brand<${formatUnknown(brand)}>`).join("")
  });
}
var BrandAnnotationId, SchemaIdAnnotationId, MessageAnnotationId, MissingMessageAnnotationId, IdentifierAnnotationId, TitleAnnotationId, AutoTitleAnnotationId, DescriptionAnnotationId, ExamplesAnnotationId, DefaultAnnotationId, JSONSchemaAnnotationId, ArbitraryAnnotationId, PrettyAnnotationId, EquivalenceAnnotationId, DocumentationAnnotationId, ConcurrencyAnnotationId, BatchingAnnotationId, ParseIssueTitleAnnotationId, ParseOptionsAnnotationId, DecodingFallbackAnnotationId, SurrogateAnnotationId, StableFilterAnnotationId, getAnnotation, getBrandAnnotation, getMessageAnnotation, getMissingMessageAnnotation, getTitleAnnotation, getAutoTitleAnnotation, getIdentifierAnnotation, getDescriptionAnnotation, getConcurrencyAnnotation, getBatchingAnnotation, getParseIssueTitleAnnotation, getParseOptionsAnnotation, getDecodingFallbackAnnotation, getSurrogateAnnotation, getStableFilterAnnotation, hasStableFilter = (annotated) => exists(getStableFilterAnnotation(annotated), (b) => b === true), JSONIdentifierAnnotationId, getJSONIdentifierAnnotation, getJSONIdentifier = (annotated) => orElse(getJSONIdentifierAnnotation(annotated), () => getIdentifierAnnotation(annotated)), createASTGuard = (tag) => (ast) => ast._tag === tag, isLiteral, undefinedKeyword, voidKeyword, neverKeyword, unknownKeyword, anyKeyword, stringKeyword, isStringKeyword, numberKeyword, booleanKeyword, bigIntKeyword, symbolKeyword, isSymbolKeyword, objectKeyword, OptionalType, getRestASTs = (rest) => rest.map((annotatedAST) => annotatedAST.type), formatTuple = (ast) => {
  const formattedElements = ast.elements.map(String).join(", ");
  return matchLeft(ast.rest, {
    onEmpty: () => `readonly [${formattedElements}]`,
    onNonEmpty: (head2, tail) => {
      const formattedHead = String(head2);
      const wrappedHead = formattedHead.includes(" | ") ? `(${formattedHead})` : formattedHead;
      if (tail.length > 0) {
        const formattedTail = tail.map(String).join(", ");
        if (ast.elements.length > 0) {
          return `readonly [${formattedElements}, ...${wrappedHead}[], ${formattedTail}]`;
        } else {
          return `readonly [...${wrappedHead}[], ${formattedTail}]`;
        }
      } else {
        if (ast.elements.length > 0) {
          return `readonly [${formattedElements}, ...${wrappedHead}[]]`;
        } else {
          return `ReadonlyArray<${formattedHead}>`;
        }
      }
    }
  });
}, PropertySignature, isParameter = (ast) => {
  switch (ast._tag) {
    case "StringKeyword":
    case "SymbolKeyword":
    case "TemplateLiteral":
      return true;
    case "Refinement":
      return isParameter(ast.from);
  }
  return false;
}, formatIndexSignatures = (iss) => iss.map(String).join("; "), formatTypeLiteral = (ast) => {
  if (ast.propertySignatures.length > 0) {
    const pss = ast.propertySignatures.map(String).join("; ");
    if (ast.indexSignatures.length > 0) {
      return `{ ${pss}; ${formatIndexSignatures(ast.indexSignatures)} }`;
    } else {
      return `{ ${pss} }`;
    }
  } else {
    if (ast.indexSignatures.length > 0) {
      return `{ ${formatIndexSignatures(ast.indexSignatures)} }`;
    } else {
      return "{}";
    }
  }
}, sortCandidates, literalMap, flatten2 = (candidates) => flatMap2(candidates, (ast) => isUnion(ast) ? flatten2(ast.types) : [ast]), unify = (candidates) => {
  const cs = sortCandidates(candidates);
  const out = [];
  const uniques = {};
  const literals = [];
  for (const ast of cs) {
    switch (ast._tag) {
      case "NeverKeyword":
        break;
      case "AnyKeyword":
        return [anyKeyword];
      case "UnknownKeyword":
        return [unknownKeyword];
      case "ObjectKeyword":
      case "UndefinedKeyword":
      case "VoidKeyword":
      case "StringKeyword":
      case "NumberKeyword":
      case "BooleanKeyword":
      case "BigIntKeyword":
      case "SymbolKeyword": {
        if (!uniques[ast._tag]) {
          uniques[ast._tag] = ast;
          out.push(ast);
        }
        break;
      }
      case "Literal": {
        const type = typeof ast.literal;
        switch (type) {
          case "string":
          case "number":
          case "bigint":
          case "boolean": {
            const _tag = literalMap[type];
            if (!uniques[_tag] && !literals.includes(ast.literal)) {
              literals.push(ast.literal);
              out.push(ast);
            }
            break;
          }
          case "object": {
            if (!literals.includes(ast.literal)) {
              literals.push(ast.literal);
              out.push(ast);
            }
            break;
          }
        }
        break;
      }
      case "UniqueSymbol": {
        if (!uniques["SymbolKeyword"] && !literals.includes(ast.symbol)) {
          literals.push(ast.symbol);
          out.push(ast);
        }
        break;
      }
      case "TupleType": {
        if (!uniques["ObjectKeyword"]) {
          out.push(ast);
        }
        break;
      }
      case "TypeLiteral": {
        if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) {
          if (!uniques["{}"]) {
            uniques["{}"] = ast;
            out.push(ast);
          }
        } else if (!uniques["ObjectKeyword"]) {
          out.push(ast);
        }
        break;
      }
      default:
        out.push(ast);
    }
  }
  return out;
}, isMembers = (as) => as.length > 1, isUnion, toJSONMemoMap, isRefinement, defaultParseOption, annotations = (ast, overrides) => {
  const d = Object.getOwnPropertyDescriptors(ast);
  const value = {
    ...ast.annotations,
    ...overrides
  };
  const surrogate = getSurrogateAnnotation(ast);
  if (isSome2(surrogate)) {
    value[SurrogateAnnotationId] = annotations(surrogate.value, overrides);
  }
  d.annotations.value = value;
  return Object.create(Object.getPrototypeOf(ast), d);
}, STRING_KEYWORD_PATTERN = "[\\s\\S]*", NUMBER_KEYWORD_PATTERN = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?", getTemplateLiteralSpanTypePattern = (type, capture) => {
  switch (type._tag) {
    case "Literal":
      return escape(String(type.literal));
    case "StringKeyword":
      return STRING_KEYWORD_PATTERN;
    case "NumberKeyword":
      return NUMBER_KEYWORD_PATTERN;
    case "TemplateLiteral":
      return getTemplateLiteralPattern(type, capture, false);
    case "Union":
      return type.types.map((type2) => getTemplateLiteralSpanTypePattern(type2, capture)).join("|");
  }
}, handleTemplateLiteralSpanTypeParens = (type, s, capture, top) => {
  if (isUnion(type)) {
    if (capture && !top) {
      return `(?:${s})`;
    }
  } else if (!capture || !top) {
    return s;
  }
  return `(${s})`;
}, getTemplateLiteralPattern = (ast, capture, top) => {
  let pattern = ``;
  if (ast.head !== "") {
    const head2 = escape(ast.head);
    pattern += capture && top ? `(${head2})` : head2;
  }
  for (const span2 of ast.spans) {
    const spanPattern = getTemplateLiteralSpanTypePattern(span2.type, capture);
    pattern += handleTemplateLiteralSpanTypeParens(span2.type, spanPattern, capture, top);
    if (span2.literal !== "") {
      const literal = escape(span2.literal);
      pattern += capture && top ? `(${literal})` : literal;
    }
  }
  return pattern;
}, getTemplateLiteralRegExp = (ast) => new RegExp(`^${getTemplateLiteralPattern(ast, false, true)}$`), pickAnnotations = (annotationIds) => (annotated) => {
  let out = undefined;
  for (const id of annotationIds) {
    if (Object.prototype.hasOwnProperty.call(annotated.annotations, id)) {
      if (out === undefined) {
        out = {};
      }
      out[id] = annotated.annotations[id];
    }
  }
  return out;
}, preserveTransformationAnnotations, typeAST = (ast) => {
  switch (ast._tag) {
    case "Declaration": {
      const typeParameters = changeMap(ast.typeParameters, typeAST);
      return typeParameters === ast.typeParameters ? ast : new Declaration(typeParameters, ast.decodeUnknown, ast.encodeUnknown, ast.annotations);
    }
    case "TupleType": {
      const elements = changeMap(ast.elements, (e) => {
        const type = typeAST(e.type);
        return type === e.type ? e : new OptionalType(type, e.isOptional);
      });
      const restASTs = getRestASTs(ast.rest);
      const rest = changeMap(restASTs, typeAST);
      return elements === ast.elements && rest === restASTs ? ast : new TupleType(elements, rest.map((type) => new Type(type)), ast.isReadonly, ast.annotations);
    }
    case "TypeLiteral": {
      const propertySignatures = changeMap(ast.propertySignatures, (p) => {
        const type = typeAST(p.type);
        return type === p.type ? p : new PropertySignature(p.name, type, p.isOptional, p.isReadonly);
      });
      const indexSignatures = changeMap(ast.indexSignatures, (is) => {
        const type = typeAST(is.type);
        return type === is.type ? is : new IndexSignature(is.parameter, type, is.isReadonly);
      });
      return propertySignatures === ast.propertySignatures && indexSignatures === ast.indexSignatures ? ast : new TypeLiteral(propertySignatures, indexSignatures, ast.annotations);
    }
    case "Union": {
      const types = changeMap(ast.types, typeAST);
      return types === ast.types ? ast : Union.make(types, ast.annotations);
    }
    case "Suspend":
      return new Suspend(() => typeAST(ast.f()), ast.annotations);
    case "Refinement": {
      const from = typeAST(ast.from);
      return from === ast.from ? ast : new Refinement(from, ast.filter, ast.annotations);
    }
    case "Transformation": {
      const preserve = preserveTransformationAnnotations(ast);
      return typeAST(preserve !== undefined ? annotations(ast.to, preserve) : ast.to);
    }
  }
  return ast;
}, createJSONIdentifierAnnotation = (annotated) => match2(getJSONIdentifier(annotated), {
  onNone: () => {
    return;
  },
  onSome: (identifier) => ({
    [JSONIdentifierAnnotationId]: identifier
  })
}), getTransformationFrom = (ast) => {
  switch (ast._tag) {
    case "Transformation":
      return ast.from;
    case "Refinement":
      return getTransformationFrom(ast.from);
    case "Suspend":
      return getTransformationFrom(ast.f());
  }
}, encodedAST_ = (ast, isBound) => {
  switch (ast._tag) {
    case "Declaration": {
      const typeParameters = changeMap(ast.typeParameters, (ast2) => encodedAST_(ast2, isBound));
      return typeParameters === ast.typeParameters ? ast : new Declaration(typeParameters, ast.decodeUnknown, ast.encodeUnknown, ast.annotations);
    }
    case "TupleType": {
      const elements = changeMap(ast.elements, (e) => {
        const type = encodedAST_(e.type, isBound);
        return type === e.type ? e : new OptionalType(type, e.isOptional);
      });
      const restASTs = getRestASTs(ast.rest);
      const rest = changeMap(restASTs, (ast2) => encodedAST_(ast2, isBound));
      return elements === ast.elements && rest === restASTs ? ast : new TupleType(elements, rest.map((ast2) => new Type(ast2)), ast.isReadonly, createJSONIdentifierAnnotation(ast));
    }
    case "TypeLiteral": {
      const propertySignatures = changeMap(ast.propertySignatures, (ps) => {
        const type = encodedAST_(ps.type, isBound);
        return type === ps.type ? ps : new PropertySignature(ps.name, type, ps.isOptional, ps.isReadonly);
      });
      const indexSignatures = changeMap(ast.indexSignatures, (is) => {
        const type = encodedAST_(is.type, isBound);
        return type === is.type ? is : new IndexSignature(is.parameter, type, is.isReadonly);
      });
      return propertySignatures === ast.propertySignatures && indexSignatures === ast.indexSignatures ? ast : new TypeLiteral(propertySignatures, indexSignatures, createJSONIdentifierAnnotation(ast));
    }
    case "Union": {
      const types = changeMap(ast.types, (ast2) => encodedAST_(ast2, isBound));
      return types === ast.types ? ast : Union.make(types, createJSONIdentifierAnnotation(ast));
    }
    case "Suspend":
      return new Suspend(() => encodedAST_(ast.f(), isBound), createJSONIdentifierAnnotation(ast));
    case "Refinement": {
      const from = encodedAST_(ast.from, isBound);
      if (isBound) {
        if (from === ast.from) {
          return ast;
        }
        if (getTransformationFrom(ast.from) === undefined && hasStableFilter(ast)) {
          return new Refinement(from, ast.filter, ast.annotations);
        }
      }
      const identifier = createJSONIdentifierAnnotation(ast);
      return identifier ? annotations(from, identifier) : from;
    }
    case "Transformation": {
      const identifier = createJSONIdentifierAnnotation(ast);
      return encodedAST_(identifier ? annotations(ast.from, identifier) : ast.from, isBound);
    }
  }
  return ast;
}, encodedAST = (ast) => encodedAST_(ast, false), toJSONAnnotations = (annotations2) => {
  const out = {};
  for (const k of Object.getOwnPropertySymbols(annotations2)) {
    out[String(k)] = annotations2[k];
  }
  return out;
}, getEncodedParameter = (ast) => {
  switch (ast._tag) {
    case "StringKeyword":
    case "SymbolKeyword":
    case "TemplateLiteral":
      return ast;
    case "Refinement":
      return getEncodedParameter(ast.from);
  }
}, formatKeyword = (ast) => getOrElse(getExpected(ast), () => ast._tag), getOrElseExpected = (ast) => getTitleAnnotation(ast).pipe(orElse(() => getDescriptionAnnotation(ast)), orElse(() => getAutoTitleAnnotation(ast)), map2((s) => s + getBrands(ast))), getExpected = (ast) => orElse(getIdentifierAnnotation(ast), () => getOrElseExpected(ast));
var init_SchemaAST = __esm(() => {
  init_Array();
  init_Function();
  init_GlobalValue();
  init_errors();
  init_util();
  init_Number();
  init_Option();
  init_Order();
  init_Predicate();
  init_RegExp();
  BrandAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Brand");
  SchemaIdAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/SchemaId");
  MessageAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Message");
  MissingMessageAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/MissingMessage");
  IdentifierAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Identifier");
  TitleAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Title");
  AutoTitleAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/AutoTitle");
  DescriptionAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Description");
  ExamplesAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Examples");
  DefaultAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Default");
  JSONSchemaAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/JSONSchema");
  ArbitraryAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Arbitrary");
  PrettyAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Pretty");
  EquivalenceAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Equivalence");
  DocumentationAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Documentation");
  ConcurrencyAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Concurrency");
  BatchingAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Batching");
  ParseIssueTitleAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/ParseIssueTitle");
  ParseOptionsAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/ParseOptions");
  DecodingFallbackAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/DecodingFallback");
  SurrogateAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/Surrogate");
  StableFilterAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/StableFilter");
  getAnnotation = /* @__PURE__ */ dual(2, (annotated, key) => Object.prototype.hasOwnProperty.call(annotated.annotations, key) ? some2(annotated.annotations[key]) : none2());
  getBrandAnnotation = /* @__PURE__ */ getAnnotation(BrandAnnotationId);
  getMessageAnnotation = /* @__PURE__ */ getAnnotation(MessageAnnotationId);
  getMissingMessageAnnotation = /* @__PURE__ */ getAnnotation(MissingMessageAnnotationId);
  getTitleAnnotation = /* @__PURE__ */ getAnnotation(TitleAnnotationId);
  getAutoTitleAnnotation = /* @__PURE__ */ getAnnotation(AutoTitleAnnotationId);
  getIdentifierAnnotation = /* @__PURE__ */ getAnnotation(IdentifierAnnotationId);
  getDescriptionAnnotation = /* @__PURE__ */ getAnnotation(DescriptionAnnotationId);
  getConcurrencyAnnotation = /* @__PURE__ */ getAnnotation(ConcurrencyAnnotationId);
  getBatchingAnnotation = /* @__PURE__ */ getAnnotation(BatchingAnnotationId);
  getParseIssueTitleAnnotation = /* @__PURE__ */ getAnnotation(ParseIssueTitleAnnotationId);
  getParseOptionsAnnotation = /* @__PURE__ */ getAnnotation(ParseOptionsAnnotationId);
  getDecodingFallbackAnnotation = /* @__PURE__ */ getAnnotation(DecodingFallbackAnnotationId);
  getSurrogateAnnotation = /* @__PURE__ */ getAnnotation(SurrogateAnnotationId);
  getStableFilterAnnotation = /* @__PURE__ */ getAnnotation(StableFilterAnnotationId);
  JSONIdentifierAnnotationId = /* @__PURE__ */ Symbol.for("effect/annotation/JSONIdentifier");
  getJSONIdentifierAnnotation = /* @__PURE__ */ getAnnotation(JSONIdentifierAnnotationId);
  isLiteral = /* @__PURE__ */ createASTGuard("Literal");
  undefinedKeyword = /* @__PURE__ */ new UndefinedKeyword({
    [TitleAnnotationId]: "undefined"
  });
  voidKeyword = /* @__PURE__ */ new VoidKeyword({
    [TitleAnnotationId]: "void"
  });
  neverKeyword = /* @__PURE__ */ new NeverKeyword({
    [TitleAnnotationId]: "never"
  });
  unknownKeyword = /* @__PURE__ */ new UnknownKeyword({
    [TitleAnnotationId]: "unknown"
  });
  anyKeyword = /* @__PURE__ */ new AnyKeyword({
    [TitleAnnotationId]: "any"
  });
  stringKeyword = /* @__PURE__ */ new StringKeyword({
    [TitleAnnotationId]: "string",
    [DescriptionAnnotationId]: "a string"
  });
  isStringKeyword = /* @__PURE__ */ createASTGuard("StringKeyword");
  numberKeyword = /* @__PURE__ */ new NumberKeyword({
    [TitleAnnotationId]: "number",
    [DescriptionAnnotationId]: "a number"
  });
  booleanKeyword = /* @__PURE__ */ new BooleanKeyword({
    [TitleAnnotationId]: "boolean",
    [DescriptionAnnotationId]: "a boolean"
  });
  bigIntKeyword = /* @__PURE__ */ new BigIntKeyword({
    [TitleAnnotationId]: "bigint",
    [DescriptionAnnotationId]: "a bigint"
  });
  symbolKeyword = /* @__PURE__ */ new SymbolKeyword({
    [TitleAnnotationId]: "symbol",
    [DescriptionAnnotationId]: "a symbol"
  });
  isSymbolKeyword = /* @__PURE__ */ createASTGuard("SymbolKeyword");
  objectKeyword = /* @__PURE__ */ new ObjectKeyword({
    [TitleAnnotationId]: "object",
    [DescriptionAnnotationId]: "an object in the TypeScript meaning, i.e. the `object` type"
  });
  OptionalType = class OptionalType extends Type {
    isOptional;
    constructor(type, isOptional, annotations = {}) {
      super(type, annotations);
      this.isOptional = isOptional;
    }
    toJSON() {
      return {
        type: this.type.toJSON(),
        isOptional: this.isOptional,
        annotations: toJSONAnnotations(this.annotations)
      };
    }
    toString() {
      return String(this.type) + (this.isOptional ? "?" : "");
    }
  };
  PropertySignature = class PropertySignature extends OptionalType {
    name;
    isReadonly;
    constructor(name, type, isOptional, isReadonly, annotations) {
      super(type, isOptional, annotations);
      this.name = name;
      this.isReadonly = isReadonly;
    }
    toString() {
      return (this.isReadonly ? "readonly " : "") + String(this.name) + (this.isOptional ? "?" : "") + ": " + this.type;
    }
    toJSON() {
      return {
        name: String(this.name),
        type: this.type.toJSON(),
        isOptional: this.isOptional,
        isReadonly: this.isReadonly,
        annotations: toJSONAnnotations(this.annotations)
      };
    }
  };
  sortCandidates = /* @__PURE__ */ sort(/* @__PURE__ */ mapInput2(Order, (ast) => {
    switch (ast._tag) {
      case "AnyKeyword":
        return 0;
      case "UnknownKeyword":
        return 1;
      case "ObjectKeyword":
        return 2;
      case "StringKeyword":
      case "NumberKeyword":
      case "BooleanKeyword":
      case "BigIntKeyword":
      case "SymbolKeyword":
        return 3;
    }
    return 4;
  }));
  literalMap = {
    string: "StringKeyword",
    number: "NumberKeyword",
    boolean: "BooleanKeyword",
    bigint: "BigIntKeyword"
  };
  isUnion = /* @__PURE__ */ createASTGuard("Union");
  toJSONMemoMap = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Schema/AST/toJSONMemoMap"), () => new WeakMap);
  isRefinement = /* @__PURE__ */ createASTGuard("Refinement");
  defaultParseOption = {};
  preserveTransformationAnnotations = /* @__PURE__ */ pickAnnotations([ExamplesAnnotationId, DefaultAnnotationId, JSONSchemaAnnotationId, ArbitraryAnnotationId, PrettyAnnotationId, EquivalenceAnnotationId]);
});

// node_modules/effect/dist/esm/Arbitrary.js
var init_Arbitrary = __esm(() => {
  init_Array();
  init_FastCheck();
  init_GlobalValue();
  init_errors();
  init_schemaId();
  init_util();
  init_Option();
  init_Predicate();
  init_SchemaAST();
});

// node_modules/effect/dist/esm/BigDecimal.js
var TypeId3, BigDecimalProto, isBigDecimal = (u) => hasProperty(u, TypeId3), make4 = (value, scale) => {
  const o = Object.create(BigDecimalProto);
  o.value = value;
  o.scale = scale;
  return o;
}, unsafeMakeNormalized = (value, scale) => {
  if (value !== bigint0 && value % bigint10 === bigint0) {
    throw new RangeError("Value must be normalized");
  }
  const o = make4(value, scale);
  o.normalized = o;
  return o;
}, bigint0, bigint10, zero, normalize = (self) => {
  if (self.normalized === undefined) {
    if (self.value === bigint0) {
      self.normalized = zero;
    } else {
      const digits = `${self.value}`;
      let trail = 0;
      for (let i = digits.length - 1;i >= 0; i--) {
        if (digits[i] === "0") {
          trail++;
        } else {
          break;
        }
      }
      if (trail === 0) {
        self.normalized = self;
      }
      const value = BigInt(digits.substring(0, digits.length - trail));
      const scale = self.scale - trail;
      self.normalized = unsafeMakeNormalized(value, scale);
    }
  }
  return self.normalized;
}, scale, abs = (n) => n.value < bigint0 ? make4(-n.value, n.scale) : n, Equivalence, equals2, format2 = (n) => {
  const normalized = normalize(n);
  if (Math.abs(normalized.scale) >= 16) {
    return toExponential(normalized);
  }
  const negative = normalized.value < bigint0;
  const absolute = negative ? `${normalized.value}`.substring(1) : `${normalized.value}`;
  let before;
  let after;
  if (normalized.scale >= absolute.length) {
    before = "0";
    after = "0".repeat(normalized.scale - absolute.length) + absolute;
  } else {
    const location = absolute.length - normalized.scale;
    if (location > absolute.length) {
      const zeros = location - absolute.length;
      before = `${absolute}${"0".repeat(zeros)}`;
      after = "";
    } else {
      after = absolute.slice(location);
      before = absolute.slice(0, location);
    }
  }
  const complete = after === "" ? before : `${before}.${after}`;
  return negative ? `-${complete}` : complete;
}, toExponential = (n) => {
  if (isZero(n)) {
    return "0e+0";
  }
  const normalized = normalize(n);
  const digits = `${abs(normalized).value}`;
  const head2 = digits.slice(0, 1);
  const tail = digits.slice(1);
  let output = `${isNegative(normalized) ? "-" : ""}${head2}`;
  if (tail !== "") {
    output += `.${tail}`;
  }
  const exp = tail.length - normalized.scale;
  return `${output}e${exp >= 0 ? "+" : ""}${exp}`;
}, isZero = (n) => n.value === bigint0, isNegative = (n) => n.value < bigint0;
var init_BigDecimal = __esm(() => {
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Order();
  init_Predicate();
  TypeId3 = /* @__PURE__ */ Symbol.for("effect/BigDecimal");
  BigDecimalProto = {
    [TypeId3]: TypeId3,
    [symbol]() {
      const normalized = normalize(this);
      return pipe(hash(normalized.value), combine(number2(normalized.scale)), cached(this));
    },
    [symbol2](that) {
      return isBigDecimal(that) && equals2(this, that);
    },
    toString() {
      return `BigDecimal(${format2(this)})`;
    },
    toJSON() {
      return {
        _id: "BigDecimal",
        value: String(this.value),
        scale: this.scale
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  bigint0 = /* @__PURE__ */ BigInt(0);
  bigint10 = /* @__PURE__ */ BigInt(10);
  zero = /* @__PURE__ */ unsafeMakeNormalized(bigint0, 0);
  scale = /* @__PURE__ */ dual(2, (self, scale2) => {
    if (scale2 > self.scale) {
      return make4(self.value * bigint10 ** BigInt(scale2 - self.scale), scale2);
    }
    if (scale2 < self.scale) {
      return make4(self.value / bigint10 ** BigInt(self.scale - scale2), scale2);
    }
    return self;
  });
  Equivalence = /* @__PURE__ */ make((self, that) => {
    if (self.scale > that.scale) {
      return scale(that, self.scale).value === self.value;
    }
    if (self.scale < that.scale) {
      return scale(self, that.scale).value === that.value;
    }
    return self.value === that.value;
  });
  equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(self, that));
});

// node_modules/effect/dist/esm/BigInt.js
var init_BigInt = __esm(() => {
  init_Equivalence();
  init_Function();
  init_Option();
  init_Order();
  init_Predicate();
});

// node_modules/effect/dist/esm/Boolean.js
var not = (self) => !self;
var init_Boolean = __esm(() => {
  init_Equivalence();
  init_Function();
  init_Order();
  init_Predicate();
});

// node_modules/effect/dist/esm/Brand.js
var init_Brand = __esm(() => {
  init_Array();
  init_Either();
  init_Function();
  init_Option();
});

// node_modules/effect/dist/esm/internal/context.js
var TagTypeId, ReferenceTypeId, STMSymbolKey = "effect/STM", STMTypeId, TagProto, ReferenceProto, makeGenericTag = (key) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  const tag = Object.create(TagProto);
  Object.defineProperty(tag, "stack", {
    get() {
      return creationError.stack;
    }
  });
  tag.key = key;
  return tag;
}, Tag = (id) => () => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  function TagClass() {}
  Object.setPrototypeOf(TagClass, TagProto);
  TagClass.key = id;
  Object.defineProperty(TagClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return TagClass;
}, Reference = () => (id, options) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  function ReferenceClass() {}
  Object.setPrototypeOf(ReferenceClass, ReferenceProto);
  ReferenceClass.key = id;
  ReferenceClass.defaultValue = options.defaultValue;
  Object.defineProperty(ReferenceClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return ReferenceClass;
}, TypeId4, ContextProto, makeContext = (unsafeMap) => {
  const context = Object.create(ContextProto);
  context.unsafeMap = unsafeMap;
  return context;
}, serviceNotFoundError = (tag) => {
  const error = new Error(`Service not found${tag.key ? `: ${String(tag.key)}` : ""}`);
  if (tag.stack) {
    const lines = tag.stack.split(`
`);
    if (lines.length > 2) {
      const afterAt = lines[2].match(/at (.*)/);
      if (afterAt) {
        error.message = error.message + ` (defined at ${afterAt[1]})`;
      }
    }
  }
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
}, isContext = (u) => hasProperty(u, TypeId4), isTag = (u) => hasProperty(u, TagTypeId), isReference = (u) => hasProperty(u, ReferenceTypeId), _empty, empty3 = () => _empty, make5 = (tag, service) => makeContext(new Map([[tag.key, service]])), add, defaultValueCache, getDefaultValue = (tag) => {
  if (defaultValueCache.has(tag.key)) {
    return defaultValueCache.get(tag.key);
  }
  const value = tag.defaultValue();
  defaultValueCache.set(tag.key, value);
  return value;
}, unsafeGetReference = (self, tag) => {
  return self.unsafeMap.has(tag.key) ? self.unsafeMap.get(tag.key) : getDefaultValue(tag);
}, unsafeGet2, get2, getOrElse2, getOption, merge2, mergeAll = (...ctxs) => {
  const map4 = new Map;
  for (const ctx of ctxs) {
    for (const [tag, s] of ctx.unsafeMap) {
      map4.set(tag, s);
    }
  }
  return makeContext(map4);
}, pick = (...tags) => (self) => {
  const tagSet = new Set(tags.map((_) => _.key));
  const newEnv = new Map;
  for (const [tag, s] of self.unsafeMap.entries()) {
    if (tagSet.has(tag)) {
      newEnv.set(tag, s);
    }
  }
  return makeContext(newEnv);
}, omit = (...tags) => (self) => {
  const newEnv = new Map(self.unsafeMap);
  for (const tag of tags) {
    newEnv.delete(tag.key);
  }
  return makeContext(newEnv);
};
var init_context = __esm(() => {
  init_Equal();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_effectable();
  init_option();
  TagTypeId = /* @__PURE__ */ Symbol.for("effect/Context/Tag");
  ReferenceTypeId = /* @__PURE__ */ Symbol.for("effect/Context/Reference");
  STMTypeId = /* @__PURE__ */ Symbol.for(STMSymbolKey);
  TagProto = {
    ...EffectPrototype,
    _op: "Tag",
    [STMTypeId]: effectVariance,
    [TagTypeId]: {
      _Service: (_) => _,
      _Identifier: (_) => _
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Tag",
        key: this.key,
        stack: this.stack
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    of(self) {
      return self;
    },
    context(self) {
      return make5(this, self);
    }
  };
  ReferenceProto = {
    ...TagProto,
    [ReferenceTypeId]: ReferenceTypeId
  };
  TypeId4 = /* @__PURE__ */ Symbol.for("effect/Context");
  ContextProto = {
    [TypeId4]: {
      _Services: (_) => _
    },
    [symbol2](that) {
      if (isContext(that)) {
        if (this.unsafeMap.size === that.unsafeMap.size) {
          for (const k of this.unsafeMap.keys()) {
            if (!that.unsafeMap.has(k) || !equals(this.unsafeMap.get(k), that.unsafeMap.get(k))) {
              return false;
            }
          }
          return true;
        }
      }
      return false;
    },
    [symbol]() {
      return cached(this, number2(this.unsafeMap.size));
    },
    pipe() {
      return pipeArguments(this, arguments);
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Context",
        services: Array.from(this.unsafeMap).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  _empty = /* @__PURE__ */ makeContext(/* @__PURE__ */ new Map);
  add = /* @__PURE__ */ dual(3, (self, tag, service) => {
    const map4 = new Map(self.unsafeMap);
    map4.set(tag.key, service);
    return makeContext(map4);
  });
  defaultValueCache = /* @__PURE__ */ globalValue("effect/Context/defaultValueCache", () => new Map);
  unsafeGet2 = /* @__PURE__ */ dual(2, (self, tag) => {
    if (!self.unsafeMap.has(tag.key)) {
      if (ReferenceTypeId in tag)
        return getDefaultValue(tag);
      throw serviceNotFoundError(tag);
    }
    return self.unsafeMap.get(tag.key);
  });
  get2 = unsafeGet2;
  getOrElse2 = /* @__PURE__ */ dual(3, (self, tag, orElse2) => {
    if (!self.unsafeMap.has(tag.key)) {
      return isReference(tag) ? getDefaultValue(tag) : orElse2();
    }
    return self.unsafeMap.get(tag.key);
  });
  getOption = /* @__PURE__ */ dual(2, (self, tag) => {
    if (!self.unsafeMap.has(tag.key)) {
      return isReference(tag) ? some(getDefaultValue(tag)) : none;
    }
    return some(self.unsafeMap.get(tag.key));
  });
  merge2 = /* @__PURE__ */ dual(2, (self, that) => {
    const map4 = new Map(self.unsafeMap);
    for (const [tag, s] of that.unsafeMap) {
      map4.set(tag, s);
    }
    return makeContext(map4);
  });
});

// node_modules/effect/dist/esm/Context.js
var exports_Context = {};
__export(exports_Context, {
  unsafeMake: () => unsafeMake,
  unsafeGet: () => unsafeGet3,
  pick: () => pick2,
  omit: () => omit2,
  mergeAll: () => mergeAll2,
  merge: () => merge3,
  make: () => make6,
  isTag: () => isTag2,
  isReference: () => isReference2,
  isContext: () => isContext2,
  getOrElse: () => getOrElse3,
  getOption: () => getOption2,
  get: () => get3,
  empty: () => empty4,
  add: () => add2,
  Tag: () => Tag2,
  Reference: () => Reference2,
  GenericTag: () => GenericTag
});
var GenericTag, unsafeMake, isContext2, isTag2, isReference2, empty4, make6, add2, get3, getOrElse3, unsafeGet3, getOption2, merge3, mergeAll2, pick2, omit2, Tag2, Reference2;
var init_Context = __esm(() => {
  init_context();
  GenericTag = makeGenericTag;
  unsafeMake = makeContext;
  isContext2 = isContext;
  isTag2 = isTag;
  isReference2 = isReference;
  empty4 = empty3;
  make6 = make5;
  add2 = add;
  get3 = get2;
  getOrElse3 = getOrElse2;
  unsafeGet3 = unsafeGet2;
  getOption2 = getOption;
  merge3 = merge2;
  mergeAll2 = mergeAll;
  pick2 = pick;
  omit2 = omit;
  Tag2 = Tag;
  Reference2 = Reference;
});

// node_modules/effect/dist/esm/Chunk.js
function copy2(src, srcPos, dest, destPos, len) {
  for (let i = srcPos;i < Math.min(src.length, srcPos + len); i++) {
    dest[destPos + i - srcPos] = src[i];
  }
  return dest;
}
var TypeId5, emptyArray, getEquivalence2 = (isEquivalent) => make((self, that) => self.length === that.length && toReadonlyArray(self).every((value, i) => isEquivalent(value, unsafeGet4(that, i)))), _equivalence3, ChunkProto, makeChunk = (backing) => {
  const chunk = Object.create(ChunkProto);
  chunk.backing = backing;
  switch (backing._tag) {
    case "IEmpty": {
      chunk.length = 0;
      chunk.depth = 0;
      chunk.left = chunk;
      chunk.right = chunk;
      break;
    }
    case "IConcat": {
      chunk.length = backing.left.length + backing.right.length;
      chunk.depth = 1 + Math.max(backing.left.depth, backing.right.depth);
      chunk.left = backing.left;
      chunk.right = backing.right;
      break;
    }
    case "IArray": {
      chunk.length = backing.array.length;
      chunk.depth = 0;
      chunk.left = _empty2;
      chunk.right = _empty2;
      break;
    }
    case "ISingleton": {
      chunk.length = 1;
      chunk.depth = 0;
      chunk.left = _empty2;
      chunk.right = _empty2;
      break;
    }
    case "ISlice": {
      chunk.length = backing.length;
      chunk.depth = backing.chunk.depth + 1;
      chunk.left = _empty2;
      chunk.right = _empty2;
      break;
    }
  }
  return chunk;
}, isChunk = (u) => hasProperty(u, TypeId5), _empty2, empty5 = () => _empty2, make7 = (...as) => unsafeFromNonEmptyArray(as), of2 = (a) => makeChunk({
  _tag: "ISingleton",
  a
}), fromIterable2 = (self) => isChunk(self) ? self : unsafeFromArray(fromIterable(self)), copyToArray = (self, array4, initial) => {
  switch (self.backing._tag) {
    case "IArray": {
      copy2(self.backing.array, 0, array4, initial, self.length);
      break;
    }
    case "IConcat": {
      copyToArray(self.left, array4, initial);
      copyToArray(self.right, array4, initial + self.left.length);
      break;
    }
    case "ISingleton": {
      array4[initial] = self.backing.a;
      break;
    }
    case "ISlice": {
      let i = 0;
      let j = initial;
      while (i < self.length) {
        array4[j] = unsafeGet4(self, i);
        i += 1;
        j += 1;
      }
      break;
    }
  }
}, toReadonlyArray_ = (self) => {
  switch (self.backing._tag) {
    case "IEmpty": {
      return emptyArray;
    }
    case "IArray": {
      return self.backing.array;
    }
    default: {
      const arr = new Array(self.length);
      copyToArray(self, arr, 0);
      self.backing = {
        _tag: "IArray",
        array: arr
      };
      self.left = _empty2;
      self.right = _empty2;
      self.depth = 0;
      return arr;
    }
  }
}, toReadonlyArray, reverseChunk = (self) => {
  switch (self.backing._tag) {
    case "IEmpty":
    case "ISingleton":
      return self;
    case "IArray": {
      return makeChunk({
        _tag: "IArray",
        array: reverse(self.backing.array)
      });
    }
    case "IConcat": {
      return makeChunk({
        _tag: "IConcat",
        left: reverse2(self.backing.right),
        right: reverse2(self.backing.left)
      });
    }
    case "ISlice":
      return unsafeFromArray(reverse(toReadonlyArray(self)));
  }
}, reverse2, get4, unsafeFromArray = (self) => self.length === 0 ? empty5() : self.length === 1 ? of2(self[0]) : makeChunk({
  _tag: "IArray",
  array: self
}), unsafeFromNonEmptyArray = (self) => unsafeFromArray(self), unsafeGet4, append2, prepend2, take, drop2, appendAll2, isEmpty = (self) => self.length === 0, isNonEmpty2 = (self) => self.length > 0, head2, unsafeHead2 = (self) => unsafeGet4(self, 0), headNonEmpty2, splitAt2, tailNonEmpty2 = (self) => drop2(self, 1);
var init_Chunk = __esm(() => {
  init_Array();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Order();
  init_Predicate();
  TypeId5 = /* @__PURE__ */ Symbol.for("effect/Chunk");
  emptyArray = [];
  _equivalence3 = /* @__PURE__ */ getEquivalence2(equals);
  ChunkProto = {
    [TypeId5]: {
      _A: (_) => _
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Chunk",
        values: toReadonlyArray(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    [symbol2](that) {
      return isChunk(that) && _equivalence3(this, that);
    },
    [symbol]() {
      return cached(this, array2(toReadonlyArray(this)));
    },
    [Symbol.iterator]() {
      switch (this.backing._tag) {
        case "IArray": {
          return this.backing.array[Symbol.iterator]();
        }
        case "IEmpty": {
          return emptyArray[Symbol.iterator]();
        }
        default: {
          return toReadonlyArray(this)[Symbol.iterator]();
        }
      }
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  _empty2 = /* @__PURE__ */ makeChunk({
    _tag: "IEmpty"
  });
  toReadonlyArray = toReadonlyArray_;
  reverse2 = reverseChunk;
  get4 = /* @__PURE__ */ dual(2, (self, index) => index < 0 || index >= self.length ? none2() : some2(unsafeGet4(self, index)));
  unsafeGet4 = /* @__PURE__ */ dual(2, (self, index) => {
    switch (self.backing._tag) {
      case "IEmpty": {
        throw new Error(`Index out of bounds`);
      }
      case "ISingleton": {
        if (index !== 0) {
          throw new Error(`Index out of bounds`);
        }
        return self.backing.a;
      }
      case "IArray": {
        if (index >= self.length || index < 0) {
          throw new Error(`Index out of bounds`);
        }
        return self.backing.array[index];
      }
      case "IConcat": {
        return index < self.left.length ? unsafeGet4(self.left, index) : unsafeGet4(self.right, index - self.left.length);
      }
      case "ISlice": {
        return unsafeGet4(self.backing.chunk, index + self.backing.offset);
      }
    }
  });
  append2 = /* @__PURE__ */ dual(2, (self, a) => appendAll2(self, of2(a)));
  prepend2 = /* @__PURE__ */ dual(2, (self, elem) => appendAll2(of2(elem), self));
  take = /* @__PURE__ */ dual(2, (self, n) => {
    if (n <= 0) {
      return _empty2;
    } else if (n >= self.length) {
      return self;
    } else {
      switch (self.backing._tag) {
        case "ISlice": {
          return makeChunk({
            _tag: "ISlice",
            chunk: self.backing.chunk,
            length: n,
            offset: self.backing.offset
          });
        }
        case "IConcat": {
          if (n > self.left.length) {
            return makeChunk({
              _tag: "IConcat",
              left: self.left,
              right: take(self.right, n - self.left.length)
            });
          }
          return take(self.left, n);
        }
        default: {
          return makeChunk({
            _tag: "ISlice",
            chunk: self,
            offset: 0,
            length: n
          });
        }
      }
    }
  });
  drop2 = /* @__PURE__ */ dual(2, (self, n) => {
    if (n <= 0) {
      return self;
    } else if (n >= self.length) {
      return _empty2;
    } else {
      switch (self.backing._tag) {
        case "ISlice": {
          return makeChunk({
            _tag: "ISlice",
            chunk: self.backing.chunk,
            offset: self.backing.offset + n,
            length: self.backing.length - n
          });
        }
        case "IConcat": {
          if (n > self.left.length) {
            return drop2(self.right, n - self.left.length);
          }
          return makeChunk({
            _tag: "IConcat",
            left: drop2(self.left, n),
            right: self.right
          });
        }
        default: {
          return makeChunk({
            _tag: "ISlice",
            chunk: self,
            offset: n,
            length: self.length - n
          });
        }
      }
    }
  });
  appendAll2 = /* @__PURE__ */ dual(2, (self, that) => {
    if (self.backing._tag === "IEmpty") {
      return that;
    }
    if (that.backing._tag === "IEmpty") {
      return self;
    }
    const diff = that.depth - self.depth;
    if (Math.abs(diff) <= 1) {
      return makeChunk({
        _tag: "IConcat",
        left: self,
        right: that
      });
    } else if (diff < -1) {
      if (self.left.depth >= self.right.depth) {
        const nr = appendAll2(self.right, that);
        return makeChunk({
          _tag: "IConcat",
          left: self.left,
          right: nr
        });
      } else {
        const nrr = appendAll2(self.right.right, that);
        if (nrr.depth === self.depth - 3) {
          const nr = makeChunk({
            _tag: "IConcat",
            left: self.right.left,
            right: nrr
          });
          return makeChunk({
            _tag: "IConcat",
            left: self.left,
            right: nr
          });
        } else {
          const nl = makeChunk({
            _tag: "IConcat",
            left: self.left,
            right: self.right.left
          });
          return makeChunk({
            _tag: "IConcat",
            left: nl,
            right: nrr
          });
        }
      }
    } else {
      if (that.right.depth >= that.left.depth) {
        const nl = appendAll2(self, that.left);
        return makeChunk({
          _tag: "IConcat",
          left: nl,
          right: that.right
        });
      } else {
        const nll = appendAll2(self, that.left.left);
        if (nll.depth === that.depth - 3) {
          const nl = makeChunk({
            _tag: "IConcat",
            left: nll,
            right: that.left.right
          });
          return makeChunk({
            _tag: "IConcat",
            left: nl,
            right: that.right
          });
        } else {
          const nr = makeChunk({
            _tag: "IConcat",
            left: that.left.right,
            right: that.right
          });
          return makeChunk({
            _tag: "IConcat",
            left: nll,
            right: nr
          });
        }
      }
    }
  });
  head2 = /* @__PURE__ */ get4(0);
  headNonEmpty2 = unsafeHead2;
  splitAt2 = /* @__PURE__ */ dual(2, (self, n) => [take(self, n), drop2(self, n)]);
});

// node_modules/effect/dist/esm/Duration.js
var TypeId6, bigint02, bigint24, bigint60, bigint1e3, bigint1e6, bigint1e9, DURATION_REGEX, decode = (input) => {
  if (isDuration(input)) {
    return input;
  } else if (isNumber(input)) {
    return millis(input);
  } else if (isBigInt(input)) {
    return nanos(input);
  } else if (Array.isArray(input) && input.length === 2 && input.every(isNumber)) {
    if (input[0] === -Infinity || input[1] === -Infinity || Number.isNaN(input[0]) || Number.isNaN(input[1])) {
      return zero2;
    }
    if (input[0] === Infinity || input[1] === Infinity) {
      return infinity;
    }
    return nanos(BigInt(Math.round(input[0] * 1e9)) + BigInt(Math.round(input[1])));
  } else if (isString(input)) {
    const match4 = DURATION_REGEX.exec(input);
    if (match4) {
      const [_, valueStr, unit] = match4;
      const value = Number(valueStr);
      switch (unit) {
        case "nano":
        case "nanos":
          return nanos(BigInt(valueStr));
        case "micro":
        case "micros":
          return micros(BigInt(valueStr));
        case "milli":
        case "millis":
          return millis(value);
        case "second":
        case "seconds":
          return seconds(value);
        case "minute":
        case "minutes":
          return minutes(value);
        case "hour":
        case "hours":
          return hours(value);
        case "day":
        case "days":
          return days(value);
        case "week":
        case "weeks":
          return weeks(value);
      }
    }
  }
  throw new Error("Invalid DurationInput");
}, zeroValue, infinityValue, DurationProto, make8 = (input) => {
  const duration = Object.create(DurationProto);
  if (isNumber(input)) {
    if (isNaN(input) || input <= 0) {
      duration.value = zeroValue;
    } else if (!Number.isFinite(input)) {
      duration.value = infinityValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: BigInt(Math.round(input * 1e6))
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input <= bigint02) {
    duration.value = zeroValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
}, isDuration = (u) => hasProperty(u, TypeId6), isZero2 = (self) => {
  switch (self.value._tag) {
    case "Millis": {
      return self.value.millis === 0;
    }
    case "Nanos": {
      return self.value.nanos === bigint02;
    }
    case "Infinity": {
      return false;
    }
  }
}, zero2, infinity, nanos = (nanos2) => make8(nanos2), micros = (micros2) => make8(micros2 * bigint1e3), millis = (millis2) => make8(millis2), seconds = (seconds2) => make8(seconds2 * 1000), minutes = (minutes2) => make8(minutes2 * 60000), hours = (hours2) => make8(hours2 * 3600000), days = (days2) => make8(days2 * 86400000), weeks = (weeks2) => make8(weeks2 * 604800000), toMillis = (self) => match4(self, {
  onMillis: (millis2) => millis2,
  onNanos: (nanos2) => Number(nanos2) / 1e6
}), unsafeToNanos = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return _self.value.nanos;
    case "Millis":
      return BigInt(Math.round(_self.value.millis * 1e6));
  }
}, toHrTime = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      return [Infinity, 0];
    case "Nanos":
      return [Number(_self.value.nanos / bigint1e9), Number(_self.value.nanos % bigint1e9)];
    case "Millis":
      return [Math.floor(_self.value.millis / 1000), Math.round(_self.value.millis % 1000 * 1e6)];
  }
}, match4, matchWith, Equivalence2 = (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 === that2,
  onNanos: (self2, that2) => self2 === that2
}), greaterThanOrEqualTo2, equals3, parts = (self) => {
  const duration = decode(self);
  if (duration.value._tag === "Infinity") {
    return {
      days: Infinity,
      hours: Infinity,
      minutes: Infinity,
      seconds: Infinity,
      millis: Infinity,
      nanos: Infinity
    };
  }
  const nanos2 = unsafeToNanos(duration);
  const ms = nanos2 / bigint1e6;
  const sec = ms / bigint1e3;
  const min2 = sec / bigint60;
  const hr = min2 / bigint60;
  const days2 = hr / bigint24;
  return {
    days: Number(days2),
    hours: Number(hr % bigint24),
    minutes: Number(min2 % bigint60),
    seconds: Number(sec % bigint60),
    millis: Number(ms % bigint1e3),
    nanos: Number(nanos2 % bigint1e6)
  };
}, format3 = (self) => {
  const duration = decode(self);
  if (duration.value._tag === "Infinity") {
    return "Infinity";
  }
  if (isZero2(duration)) {
    return "0";
  }
  const fragments = parts(duration);
  const pieces = [];
  if (fragments.days !== 0) {
    pieces.push(`${fragments.days}d`);
  }
  if (fragments.hours !== 0) {
    pieces.push(`${fragments.hours}h`);
  }
  if (fragments.minutes !== 0) {
    pieces.push(`${fragments.minutes}m`);
  }
  if (fragments.seconds !== 0) {
    pieces.push(`${fragments.seconds}s`);
  }
  if (fragments.millis !== 0) {
    pieces.push(`${fragments.millis}ms`);
  }
  if (fragments.nanos !== 0) {
    pieces.push(`${fragments.nanos}ns`);
  }
  return pieces.join(" ");
};
var init_Duration = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Order();
  init_Predicate();
  TypeId6 = /* @__PURE__ */ Symbol.for("effect/Duration");
  bigint02 = /* @__PURE__ */ BigInt(0);
  bigint24 = /* @__PURE__ */ BigInt(24);
  bigint60 = /* @__PURE__ */ BigInt(60);
  bigint1e3 = /* @__PURE__ */ BigInt(1000);
  bigint1e6 = /* @__PURE__ */ BigInt(1e6);
  bigint1e9 = /* @__PURE__ */ BigInt(1e9);
  DURATION_REGEX = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
  zeroValue = {
    _tag: "Millis",
    millis: 0
  };
  infinityValue = {
    _tag: "Infinity"
  };
  DurationProto = {
    [TypeId6]: TypeId6,
    [symbol]() {
      return cached(this, structure(this.value));
    },
    [symbol2](that) {
      return isDuration(that) && equals3(this, that);
    },
    toString() {
      return `Duration(${format3(this)})`;
    },
    toJSON() {
      switch (this.value._tag) {
        case "Millis":
          return {
            _id: "Duration",
            _tag: "Millis",
            millis: this.value.millis
          };
        case "Nanos":
          return {
            _id: "Duration",
            _tag: "Nanos",
            hrtime: toHrTime(this)
          };
        case "Infinity":
          return {
            _id: "Duration",
            _tag: "Infinity"
          };
      }
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  zero2 = /* @__PURE__ */ make8(0);
  infinity = /* @__PURE__ */ make8(Infinity);
  match4 = /* @__PURE__ */ dual(2, (self, options) => {
    const _self = decode(self);
    switch (_self.value._tag) {
      case "Nanos":
        return options.onNanos(_self.value.nanos);
      case "Infinity":
        return options.onMillis(Infinity);
      case "Millis":
        return options.onMillis(_self.value.millis);
    }
  });
  matchWith = /* @__PURE__ */ dual(3, (self, that, options) => {
    const _self = decode(self);
    const _that = decode(that);
    if (_self.value._tag === "Infinity" || _that.value._tag === "Infinity") {
      return options.onMillis(toMillis(_self), toMillis(_that));
    } else if (_self.value._tag === "Nanos" || _that.value._tag === "Nanos") {
      const selfNanos = _self.value._tag === "Nanos" ? _self.value.nanos : BigInt(Math.round(_self.value.millis * 1e6));
      const thatNanos = _that.value._tag === "Nanos" ? _that.value.nanos : BigInt(Math.round(_that.value.millis * 1e6));
      return options.onNanos(selfNanos, thatNanos);
    }
    return options.onMillis(_self.value.millis, _that.value.millis);
  });
  greaterThanOrEqualTo2 = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
    onMillis: (self2, that2) => self2 >= that2,
    onNanos: (self2, that2) => self2 >= that2
  }));
  equals3 = /* @__PURE__ */ dual(2, (self, that) => Equivalence2(decode(self), decode(that)));
});

// node_modules/effect/dist/esm/internal/hashMap/config.js
var SIZE = 5, BUCKET_SIZE, MASK, MAX_INDEX_NODE, MIN_ARRAY_NODE;
var init_config = __esm(() => {
  BUCKET_SIZE = /* @__PURE__ */ Math.pow(2, SIZE);
  MASK = BUCKET_SIZE - 1;
  MAX_INDEX_NODE = BUCKET_SIZE / 2;
  MIN_ARRAY_NODE = BUCKET_SIZE / 4;
});

// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function popcount(x) {
  x -= x >> 1 & 1431655765;
  x = (x & 858993459) + (x >> 2 & 858993459);
  x = x + (x >> 4) & 252645135;
  x += x >> 8;
  x += x >> 16;
  return x & 127;
}
function hashFragment(shift, h) {
  return h >>> shift & MASK;
}
function toBitmap(x) {
  return 1 << x;
}
function fromBitmap(bitmap, bit) {
  return popcount(bitmap & bit - 1);
}
var init_bitwise = __esm(() => {
  init_config();
});

// node_modules/effect/dist/esm/internal/stack.js
var make9 = (value, previous) => ({
  value,
  previous
});

// node_modules/effect/dist/esm/internal/hashMap/array.js
function arrayUpdate(mutate, at, v, arr) {
  let out = arr;
  if (!mutate) {
    const len = arr.length;
    out = new Array(len);
    for (let i = 0;i < len; ++i)
      out[i] = arr[i];
  }
  out[at] = v;
  return out;
}
function arraySpliceOut(mutate, at, arr) {
  const newLen = arr.length - 1;
  let i = 0;
  let g = 0;
  let out = arr;
  if (mutate) {
    i = g = at;
  } else {
    out = new Array(newLen);
    while (i < at)
      out[g++] = arr[i++];
  }
  ++i;
  while (i <= newLen)
    out[g++] = arr[i++];
  if (mutate) {
    out.length = newLen;
  }
  return out;
}
function arraySpliceIn(mutate, at, v, arr) {
  const len = arr.length;
  if (mutate) {
    let i2 = len;
    while (i2 >= at)
      arr[i2--] = arr[i2];
    arr[at] = v;
    return arr;
  }
  let i = 0, g = 0;
  const out = new Array(len + 1);
  while (i < at)
    out[g++] = arr[i++];
  out[at] = v;
  while (i < len)
    out[++g] = arr[i++];
  return out;
}

// node_modules/effect/dist/esm/internal/hashMap/node.js
class EmptyNode {
  _tag = "EmptyNode";
  modify(edit, _shift, f, hash2, key, size) {
    const v = f(none2());
    if (isNone2(v))
      return new EmptyNode;
    ++size.value;
    return new LeafNode(edit, hash2, key, v);
  }
}
function isEmptyNode(a) {
  return isTagged(a, "EmptyNode");
}
function isLeafNode(node) {
  return isEmptyNode(node) || node._tag === "LeafNode" || node._tag === "CollisionNode";
}
function canEditNode(node, edit) {
  return isEmptyNode(node) ? false : edit === node.edit;
}

class LeafNode {
  edit;
  hash;
  key;
  value;
  _tag = "LeafNode";
  constructor(edit, hash2, key, value) {
    this.edit = edit;
    this.hash = hash2;
    this.key = key;
    this.value = value;
  }
  modify(edit, shift, f, hash2, key, size) {
    if (equals(key, this.key)) {
      const v2 = f(this.value);
      if (v2 === this.value)
        return this;
      else if (isNone2(v2)) {
        --size.value;
        return new EmptyNode;
      }
      if (canEditNode(this, edit)) {
        this.value = v2;
        return this;
      }
      return new LeafNode(edit, hash2, key, v2);
    }
    const v = f(none2());
    if (isNone2(v))
      return this;
    ++size.value;
    return mergeLeaves(edit, shift, this.hash, this, hash2, new LeafNode(edit, hash2, key, v));
  }
}

class CollisionNode {
  edit;
  hash;
  children;
  _tag = "CollisionNode";
  constructor(edit, hash2, children) {
    this.edit = edit;
    this.hash = hash2;
    this.children = children;
  }
  modify(edit, shift, f, hash2, key, size) {
    if (hash2 === this.hash) {
      const canEdit = canEditNode(this, edit);
      const list = this.updateCollisionList(canEdit, edit, this.hash, this.children, f, key, size);
      if (list === this.children)
        return this;
      return list.length > 1 ? new CollisionNode(edit, this.hash, list) : list[0];
    }
    const v = f(none2());
    if (isNone2(v))
      return this;
    ++size.value;
    return mergeLeaves(edit, shift, this.hash, this, hash2, new LeafNode(edit, hash2, key, v));
  }
  updateCollisionList(mutate, edit, hash2, list, f, key, size) {
    const len = list.length;
    for (let i = 0;i < len; ++i) {
      const child = list[i];
      if ("key" in child && equals(key, child.key)) {
        const value = child.value;
        const newValue2 = f(value);
        if (newValue2 === value)
          return list;
        if (isNone2(newValue2)) {
          --size.value;
          return arraySpliceOut(mutate, i, list);
        }
        return arrayUpdate(mutate, i, new LeafNode(edit, hash2, key, newValue2), list);
      }
    }
    const newValue = f(none2());
    if (isNone2(newValue))
      return list;
    ++size.value;
    return arrayUpdate(mutate, len, new LeafNode(edit, hash2, key, newValue), list);
  }
}

class IndexedNode {
  edit;
  mask;
  children;
  _tag = "IndexedNode";
  constructor(edit, mask, children) {
    this.edit = edit;
    this.mask = mask;
    this.children = children;
  }
  modify(edit, shift, f, hash2, key, size) {
    const mask = this.mask;
    const children = this.children;
    const frag = hashFragment(shift, hash2);
    const bit = toBitmap(frag);
    const indx = fromBitmap(mask, bit);
    const exists2 = mask & bit;
    const canEdit = canEditNode(this, edit);
    if (!exists2) {
      const _newChild = new EmptyNode().modify(edit, shift + SIZE, f, hash2, key, size);
      if (!_newChild)
        return this;
      return children.length >= MAX_INDEX_NODE ? expand(edit, frag, _newChild, mask, children) : new IndexedNode(edit, mask | bit, arraySpliceIn(canEdit, indx, _newChild, children));
    }
    const current = children[indx];
    const child = current.modify(edit, shift + SIZE, f, hash2, key, size);
    if (current === child)
      return this;
    let bitmap = mask;
    let newChildren;
    if (isEmptyNode(child)) {
      bitmap &= ~bit;
      if (!bitmap)
        return new EmptyNode;
      if (children.length <= 2 && isLeafNode(children[indx ^ 1])) {
        return children[indx ^ 1];
      }
      newChildren = arraySpliceOut(canEdit, indx, children);
    } else {
      newChildren = arrayUpdate(canEdit, indx, child, children);
    }
    if (canEdit) {
      this.mask = bitmap;
      this.children = newChildren;
      return this;
    }
    return new IndexedNode(edit, bitmap, newChildren);
  }
}

class ArrayNode {
  edit;
  size;
  children;
  _tag = "ArrayNode";
  constructor(edit, size, children) {
    this.edit = edit;
    this.size = size;
    this.children = children;
  }
  modify(edit, shift, f, hash2, key, size) {
    let count = this.size;
    const children = this.children;
    const frag = hashFragment(shift, hash2);
    const child = children[frag];
    const newChild = (child || new EmptyNode).modify(edit, shift + SIZE, f, hash2, key, size);
    if (child === newChild)
      return this;
    const canEdit = canEditNode(this, edit);
    let newChildren;
    if (isEmptyNode(child) && !isEmptyNode(newChild)) {
      ++count;
      newChildren = arrayUpdate(canEdit, frag, newChild, children);
    } else if (!isEmptyNode(child) && isEmptyNode(newChild)) {
      --count;
      if (count <= MIN_ARRAY_NODE) {
        return pack(edit, count, frag, children);
      }
      newChildren = arrayUpdate(canEdit, frag, new EmptyNode, children);
    } else {
      newChildren = arrayUpdate(canEdit, frag, newChild, children);
    }
    if (canEdit) {
      this.size = count;
      this.children = newChildren;
      return this;
    }
    return new ArrayNode(edit, count, newChildren);
  }
}
function pack(edit, count, removed, elements) {
  const children = new Array(count - 1);
  let g = 0;
  let bitmap = 0;
  for (let i = 0, len = elements.length;i < len; ++i) {
    if (i !== removed) {
      const elem = elements[i];
      if (elem && !isEmptyNode(elem)) {
        children[g++] = elem;
        bitmap |= 1 << i;
      }
    }
  }
  return new IndexedNode(edit, bitmap, children);
}
function expand(edit, frag, child, bitmap, subNodes) {
  const arr = [];
  let bit = bitmap;
  let count = 0;
  for (let i = 0;bit; ++i) {
    if (bit & 1)
      arr[i] = subNodes[count++];
    bit >>>= 1;
  }
  arr[frag] = child;
  return new ArrayNode(edit, count + 1, arr);
}
function mergeLeavesInner(edit, shift, h1, n1, h2, n2) {
  if (h1 === h2)
    return new CollisionNode(edit, h1, [n2, n1]);
  const subH1 = hashFragment(shift, h1);
  const subH2 = hashFragment(shift, h2);
  if (subH1 === subH2) {
    return (child) => new IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), [child]);
  } else {
    const children = subH1 < subH2 ? [n1, n2] : [n2, n1];
    return new IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), children);
  }
}
function mergeLeaves(edit, shift, h1, n1, h2, n2) {
  let stack = undefined;
  let currentShift = shift;
  while (true) {
    const res = mergeLeavesInner(edit, currentShift, h1, n1, h2, n2);
    if (typeof res === "function") {
      stack = make9(res, stack);
      currentShift = currentShift + SIZE;
    } else {
      let final = res;
      while (stack != null) {
        final = stack.value(final);
        stack = stack.previous;
      }
      return final;
    }
  }
}
var init_node = __esm(() => {
  init_Equal();
  init_Option();
  init_Predicate();
  init_bitwise();
  init_config();
});

// node_modules/effect/dist/esm/internal/hashMap.js
var HashMapSymbolKey = "effect/HashMap", HashMapTypeId, HashMapProto, makeImpl = (editable, edit, root, size) => {
  const map4 = Object.create(HashMapProto);
  map4._editable = editable;
  map4._edit = edit;
  map4._root = root;
  map4._size = size;
  return map4;
}, HashMapIterator, applyCont = (cont) => cont ? visitLazyChildren(cont[0], cont[1], cont[2], cont[3], cont[4]) : none2(), visitLazy = (node, f, cont = undefined) => {
  switch (node._tag) {
    case "LeafNode": {
      if (isSome2(node.value)) {
        return some2({
          value: f(node.key, node.value.value),
          cont
        });
      }
      return applyCont(cont);
    }
    case "CollisionNode":
    case "ArrayNode":
    case "IndexedNode": {
      const children = node.children;
      return visitLazyChildren(children.length, children, 0, f, cont);
    }
    default: {
      return applyCont(cont);
    }
  }
}, visitLazyChildren = (len, children, i, f, cont) => {
  while (i < len) {
    const child = children[i++];
    if (child && !isEmptyNode(child)) {
      return visitLazy(child, f, [len, children, i, f, cont]);
    }
  }
  return applyCont(cont);
}, _empty3, empty6 = () => _empty3, fromIterable3 = (entries) => {
  const map4 = beginMutation(empty6());
  for (const entry of entries) {
    set(map4, entry[0], entry[1]);
  }
  return endMutation(map4);
}, isHashMap = (u) => hasProperty(u, HashMapTypeId), isEmpty2 = (self) => self && isEmptyNode(self._root), get5, getHash, has, set, setTree, keys = (self) => new HashMapIterator(self, (key) => key), size = (self) => self._size, beginMutation = (self) => makeImpl(true, self._edit + 1, self._root, self._size), endMutation = (self) => {
  self._editable = false;
  return self;
}, mutate, modifyAt, modifyHash, remove2, map4, forEach, reduce2;
var init_hashMap = __esm(() => {
  init_Equal();
  init_Function();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Predicate();
  init_bitwise();
  init_config();
  init_node();
  HashMapTypeId = /* @__PURE__ */ Symbol.for(HashMapSymbolKey);
  HashMapProto = {
    [HashMapTypeId]: HashMapTypeId,
    [Symbol.iterator]() {
      return new HashMapIterator(this, (k, v) => [k, v]);
    },
    [symbol]() {
      let hash2 = hash(HashMapSymbolKey);
      for (const item of this) {
        hash2 ^= pipe(hash(item[0]), combine(hash(item[1])));
      }
      return cached(this, hash2);
    },
    [symbol2](that) {
      if (isHashMap(that)) {
        if (that._size !== this._size) {
          return false;
        }
        for (const item of this) {
          const elem = pipe(that, getHash(item[0], hash(item[0])));
          if (isNone2(elem)) {
            return false;
          } else {
            if (!equals(item[1], elem.value)) {
              return false;
            }
          }
        }
        return true;
      }
      return false;
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "HashMap",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  HashMapIterator = class HashMapIterator {
    map;
    f;
    v;
    constructor(map4, f) {
      this.map = map4;
      this.f = f;
      this.v = visitLazy(this.map._root, this.f, undefined);
    }
    next() {
      if (isNone2(this.v)) {
        return {
          done: true,
          value: undefined
        };
      }
      const v0 = this.v.value;
      this.v = applyCont(v0.cont);
      return {
        done: false,
        value: v0.value
      };
    }
    [Symbol.iterator]() {
      return new HashMapIterator(this.map, this.f);
    }
  };
  _empty3 = /* @__PURE__ */ makeImpl(false, 0, /* @__PURE__ */ new EmptyNode, 0);
  get5 = /* @__PURE__ */ dual(2, (self, key) => getHash(self, key, hash(key)));
  getHash = /* @__PURE__ */ dual(3, (self, key, hash2) => {
    let node = self._root;
    let shift = 0;
    while (true) {
      switch (node._tag) {
        case "LeafNode": {
          return equals(key, node.key) ? node.value : none2();
        }
        case "CollisionNode": {
          if (hash2 === node.hash) {
            const children = node.children;
            for (let i = 0, len = children.length;i < len; ++i) {
              const child = children[i];
              if ("key" in child && equals(key, child.key)) {
                return child.value;
              }
            }
          }
          return none2();
        }
        case "IndexedNode": {
          const frag = hashFragment(shift, hash2);
          const bit = toBitmap(frag);
          if (node.mask & bit) {
            node = node.children[fromBitmap(node.mask, bit)];
            shift += SIZE;
            break;
          }
          return none2();
        }
        case "ArrayNode": {
          node = node.children[hashFragment(shift, hash2)];
          if (node) {
            shift += SIZE;
            break;
          }
          return none2();
        }
        default:
          return none2();
      }
    }
  });
  has = /* @__PURE__ */ dual(2, (self, key) => isSome2(getHash(self, key, hash(key))));
  set = /* @__PURE__ */ dual(3, (self, key, value) => modifyAt(self, key, () => some2(value)));
  setTree = /* @__PURE__ */ dual(3, (self, newRoot, newSize) => {
    if (self._editable) {
      self._root = newRoot;
      self._size = newSize;
      return self;
    }
    return newRoot === self._root ? self : makeImpl(self._editable, self._edit, newRoot, newSize);
  });
  mutate = /* @__PURE__ */ dual(2, (self, f) => {
    const transient = beginMutation(self);
    f(transient);
    return endMutation(transient);
  });
  modifyAt = /* @__PURE__ */ dual(3, (self, key, f) => modifyHash(self, key, hash(key), f));
  modifyHash = /* @__PURE__ */ dual(4, (self, key, hash2, f) => {
    const size2 = {
      value: self._size
    };
    const newRoot = self._root.modify(self._editable ? self._edit : NaN, 0, f, hash2, key, size2);
    return pipe(self, setTree(newRoot, size2.value));
  });
  remove2 = /* @__PURE__ */ dual(2, (self, key) => modifyAt(self, key, none2));
  map4 = /* @__PURE__ */ dual(2, (self, f) => reduce2(self, empty6(), (map5, value, key) => set(map5, key, f(value, key))));
  forEach = /* @__PURE__ */ dual(2, (self, f) => reduce2(self, undefined, (_, value, key) => f(value, key)));
  reduce2 = /* @__PURE__ */ dual(3, (self, zero3, f) => {
    const root = self._root;
    if (root._tag === "LeafNode") {
      return isSome2(root.value) ? f(zero3, root.value.value, root.key) : zero3;
    }
    if (root._tag === "EmptyNode") {
      return zero3;
    }
    const toVisit = [root.children];
    let children;
    while (children = toVisit.pop()) {
      for (let i = 0, len = children.length;i < len; ) {
        const child = children[i++];
        if (child && !isEmptyNode(child)) {
          if (child._tag === "LeafNode") {
            if (isSome2(child.value)) {
              zero3 = f(zero3, child.value.value, child.key);
            }
          } else {
            toVisit.push(child.children);
          }
        }
      }
    }
    return zero3;
  });
});

// node_modules/effect/dist/esm/internal/hashSet.js
var HashSetSymbolKey = "effect/HashSet", HashSetTypeId, HashSetProto, makeImpl2 = (keyMap) => {
  const set2 = Object.create(HashSetProto);
  set2._keyMap = keyMap;
  return set2;
}, isHashSet = (u) => hasProperty(u, HashSetTypeId), _empty4, empty7 = () => _empty4, fromIterable4 = (elements) => {
  const set2 = beginMutation2(empty7());
  for (const value of elements) {
    add3(set2, value);
  }
  return endMutation2(set2);
}, make10 = (...elements) => {
  const set2 = beginMutation2(empty7());
  for (const value of elements) {
    add3(set2, value);
  }
  return endMutation2(set2);
}, has2, size2 = (self) => size(self._keyMap), beginMutation2 = (self) => makeImpl2(beginMutation(self._keyMap)), endMutation2 = (self) => {
  self._keyMap._editable = false;
  return self;
}, mutate2, add3, remove3, difference2, union2, forEach2, reduce3;
var init_hashSet = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_hashMap();
  HashSetTypeId = /* @__PURE__ */ Symbol.for(HashSetSymbolKey);
  HashSetProto = {
    [HashSetTypeId]: HashSetTypeId,
    [Symbol.iterator]() {
      return keys(this._keyMap);
    },
    [symbol]() {
      return cached(this, combine(hash(this._keyMap))(hash(HashSetSymbolKey)));
    },
    [symbol2](that) {
      if (isHashSet(that)) {
        return size(this._keyMap) === size(that._keyMap) && equals(this._keyMap, that._keyMap);
      }
      return false;
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "HashSet",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  _empty4 = /* @__PURE__ */ makeImpl2(/* @__PURE__ */ empty6());
  has2 = /* @__PURE__ */ dual(2, (self, value) => has(self._keyMap, value));
  mutate2 = /* @__PURE__ */ dual(2, (self, f) => {
    const transient = beginMutation2(self);
    f(transient);
    return endMutation2(transient);
  });
  add3 = /* @__PURE__ */ dual(2, (self, value) => self._keyMap._editable ? (set(value, true)(self._keyMap), self) : makeImpl2(set(value, true)(self._keyMap)));
  remove3 = /* @__PURE__ */ dual(2, (self, value) => self._keyMap._editable ? (remove2(value)(self._keyMap), self) : makeImpl2(remove2(value)(self._keyMap)));
  difference2 = /* @__PURE__ */ dual(2, (self, that) => mutate2(self, (set2) => {
    for (const value of that) {
      remove3(set2, value);
    }
  }));
  union2 = /* @__PURE__ */ dual(2, (self, that) => mutate2(empty7(), (set2) => {
    forEach2(self, (value) => add3(set2, value));
    for (const value of that) {
      add3(set2, value);
    }
  }));
  forEach2 = /* @__PURE__ */ dual(2, (self, f) => forEach(self._keyMap, (_, k) => f(k)));
  reduce3 = /* @__PURE__ */ dual(3, (self, zero3, f) => reduce2(self._keyMap, zero3, (z, _, a) => f(z, a)));
});

// node_modules/effect/dist/esm/HashSet.js
var empty8, fromIterable5, make11, has3, size3, add4, remove4, difference3, union3, forEach3, reduce4;
var init_HashSet = __esm(() => {
  init_hashSet();
  empty8 = empty7;
  fromIterable5 = fromIterable4;
  make11 = make10;
  has3 = has2;
  size3 = size2;
  add4 = add3;
  remove4 = remove3;
  difference3 = difference2;
  union3 = union2;
  forEach3 = forEach2;
  reduce4 = reduce3;
});

// node_modules/effect/dist/esm/MutableRef.js
var TypeId7, MutableRefProto, make12 = (value) => {
  const ref = Object.create(MutableRefProto);
  ref.current = value;
  return ref;
}, compareAndSet, get6 = (self) => self.current, set2;
var init_MutableRef = __esm(() => {
  init_Equal();
  init_Function();
  init_Inspectable();
  TypeId7 = /* @__PURE__ */ Symbol.for("effect/MutableRef");
  MutableRefProto = {
    [TypeId7]: TypeId7,
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableRef",
        current: toJSON(this.current)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  compareAndSet = /* @__PURE__ */ dual(3, (self, oldValue, newValue) => {
    if (equals(oldValue, self.current)) {
      self.current = newValue;
      return true;
    }
    return false;
  });
  set2 = /* @__PURE__ */ dual(2, (self, value) => {
    self.current = value;
    return self;
  });
});

// node_modules/effect/dist/esm/internal/fiberId.js
var FiberIdSymbolKey = "effect/FiberId", FiberIdTypeId, OP_NONE = "None", OP_RUNTIME = "Runtime", OP_COMPOSITE = "Composite", emptyHash, None, Runtime, Composite, none3, isFiberId = (self) => hasProperty(self, FiberIdTypeId), combine2, ids = (self) => {
  switch (self._tag) {
    case OP_NONE: {
      return empty8();
    }
    case OP_RUNTIME: {
      return make11(self.id);
    }
    case OP_COMPOSITE: {
      return pipe(ids(self.left), union3(ids(self.right)));
    }
  }
}, _fiberCounter, threadName = (self) => {
  const identifiers = Array.from(ids(self)).map((n) => `#${n}`).join(",");
  return identifiers;
}, unsafeMake2 = () => {
  const id = get6(_fiberCounter);
  pipe(_fiberCounter, set2(id + 1));
  return new Runtime(id, Date.now());
};
var init_fiberId = __esm(() => {
  init_Equal();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_HashSet();
  init_Inspectable();
  init_MutableRef();
  init_Option();
  init_Predicate();
  FiberIdTypeId = /* @__PURE__ */ Symbol.for(FiberIdSymbolKey);
  emptyHash = /* @__PURE__ */ string(`${FiberIdSymbolKey}-${OP_NONE}`);
  None = class None {
    [FiberIdTypeId] = FiberIdTypeId;
    _tag = OP_NONE;
    id = -1;
    startTimeMillis = -1;
    [symbol]() {
      return emptyHash;
    }
    [symbol2](that) {
      return isFiberId(that) && that._tag === OP_NONE;
    }
    toString() {
      return format(this.toJSON());
    }
    toJSON() {
      return {
        _id: "FiberId",
        _tag: this._tag
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  Runtime = class Runtime {
    id;
    startTimeMillis;
    [FiberIdTypeId] = FiberIdTypeId;
    _tag = OP_RUNTIME;
    constructor(id, startTimeMillis) {
      this.id = id;
      this.startTimeMillis = startTimeMillis;
    }
    [symbol]() {
      return cached(this, string(`${FiberIdSymbolKey}-${this._tag}-${this.id}-${this.startTimeMillis}`));
    }
    [symbol2](that) {
      return isFiberId(that) && that._tag === OP_RUNTIME && this.id === that.id && this.startTimeMillis === that.startTimeMillis;
    }
    toString() {
      return format(this.toJSON());
    }
    toJSON() {
      return {
        _id: "FiberId",
        _tag: this._tag,
        id: this.id,
        startTimeMillis: this.startTimeMillis
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  Composite = class Composite {
    left;
    right;
    [FiberIdTypeId] = FiberIdTypeId;
    _tag = OP_COMPOSITE;
    constructor(left3, right3) {
      this.left = left3;
      this.right = right3;
    }
    _hash;
    [symbol]() {
      return pipe(string(`${FiberIdSymbolKey}-${this._tag}`), combine(hash(this.left)), combine(hash(this.right)), cached(this));
    }
    [symbol2](that) {
      return isFiberId(that) && that._tag === OP_COMPOSITE && equals(this.left, that.left) && equals(this.right, that.right);
    }
    toString() {
      return format(this.toJSON());
    }
    toJSON() {
      return {
        _id: "FiberId",
        _tag: this._tag,
        left: toJSON(this.left),
        right: toJSON(this.right)
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  none3 = /* @__PURE__ */ new None;
  combine2 = /* @__PURE__ */ dual(2, (self, that) => {
    if (self._tag === OP_NONE) {
      return that;
    }
    if (that._tag === OP_NONE) {
      return self;
    }
    return new Composite(self, that);
  });
  _fiberCounter = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => make12(0));
});

// node_modules/effect/dist/esm/FiberId.js
var none4, combine3, threadName2, unsafeMake3;
var init_FiberId = __esm(() => {
  init_fiberId();
  none4 = none3;
  combine3 = combine2;
  threadName2 = threadName;
  unsafeMake3 = unsafeMake2;
});

// node_modules/effect/dist/esm/internal/hashMap/keySet.js
var init_keySet = __esm(() => {
  init_hashSet();
});

// node_modules/effect/dist/esm/HashMap.js
var empty9, fromIterable6, isEmpty3, get7, set3, keys2, mutate3, modifyAt2, map6, forEach4, reduce5;
var init_HashMap = __esm(() => {
  init_hashMap();
  init_keySet();
  empty9 = empty6;
  fromIterable6 = fromIterable3;
  isEmpty3 = isEmpty2;
  get7 = get5;
  set3 = set;
  keys2 = keys;
  mutate3 = mutate;
  modifyAt2 = modifyAt;
  map6 = map4;
  forEach4 = forEach;
  reduce5 = reduce2;
});

// node_modules/effect/dist/esm/List.js
var TypeId8, toArray2 = (self) => fromIterable(self), getEquivalence3 = (isEquivalent) => mapInput(getEquivalence(isEquivalent), toArray2), _equivalence4, ConsProto, makeCons = (head3, tail) => {
  const cons = Object.create(ConsProto);
  cons.head = head3;
  cons.tail = tail;
  return cons;
}, NilHash, NilProto, _Nil, isList = (u) => hasProperty(u, TypeId8), isNil = (self) => self._tag === "Nil", isCons = (self) => self._tag === "Cons", nil = () => _Nil, cons = (head3, tail) => makeCons(head3, tail), empty10, of3 = (value) => makeCons(value, _Nil), appendAll3, prepend3, prependAll, reduce6, reverse3 = (self) => {
  let result = empty10();
  let these = self;
  while (!isNil(these)) {
    result = prepend3(result, these.head);
    these = these.tail;
  }
  return result;
};
var init_List = __esm(() => {
  init_Array();
  init_Chunk();
  init_Either();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Predicate();
  TypeId8 = /* @__PURE__ */ Symbol.for("effect/List");
  _equivalence4 = /* @__PURE__ */ getEquivalence3(equals);
  ConsProto = {
    [TypeId8]: TypeId8,
    _tag: "Cons",
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "List",
        _tag: "Cons",
        values: toArray2(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    [symbol2](that) {
      return isList(that) && this._tag === that._tag && _equivalence4(this, that);
    },
    [symbol]() {
      return cached(this, array2(toArray2(this)));
    },
    [Symbol.iterator]() {
      let done = false;
      let self = this;
      return {
        next() {
          if (done) {
            return this.return();
          }
          if (self._tag === "Nil") {
            done = true;
            return this.return();
          }
          const value = self.head;
          self = self.tail;
          return {
            done,
            value
          };
        },
        return(value) {
          if (!done) {
            done = true;
          }
          return {
            done: true,
            value
          };
        }
      };
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  NilHash = /* @__PURE__ */ string("Nil");
  NilProto = {
    [TypeId8]: TypeId8,
    _tag: "Nil",
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "List",
        _tag: "Nil"
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    [symbol]() {
      return NilHash;
    },
    [symbol2](that) {
      return isList(that) && this._tag === that._tag;
    },
    [Symbol.iterator]() {
      return {
        next() {
          return {
            done: true,
            value: undefined
          };
        }
      };
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  _Nil = /* @__PURE__ */ Object.create(NilProto);
  empty10 = nil;
  appendAll3 = /* @__PURE__ */ dual(2, (self, that) => prependAll(that, self));
  prepend3 = /* @__PURE__ */ dual(2, (self, element) => cons(element, self));
  prependAll = /* @__PURE__ */ dual(2, (self, prefix) => {
    if (isNil(self)) {
      return prefix;
    } else if (isNil(prefix)) {
      return self;
    } else {
      const result = makeCons(prefix.head, self);
      let curr = result;
      let that = prefix.tail;
      while (!isNil(that)) {
        const temp = makeCons(that.head, self);
        curr.tail = temp;
        curr = temp;
        that = that.tail;
      }
      return result;
    }
  });
  reduce6 = /* @__PURE__ */ dual(3, (self, zero3, f) => {
    let acc = zero3;
    let these = self;
    while (!isNil(these)) {
      acc = f(acc, these.head);
      these = these.tail;
    }
    return acc;
  });
});

// node_modules/effect/dist/esm/internal/data.js
var ArrayProto, Structural, struct = (as) => Object.assign(Object.create(StructuralPrototype), as);
var init_data = __esm(() => {
  init_Equal();
  init_Hash();
  init_effectable();
  ArrayProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(Array.prototype), {
    [symbol]() {
      return cached(this, array2(this));
    },
    [symbol2](that) {
      if (Array.isArray(that) && this.length === that.length) {
        return this.every((v, i) => equals(v, that[i]));
      } else {
        return false;
      }
    }
  });
  Structural = /* @__PURE__ */ function() {
    function Structural2(args) {
      if (args) {
        Object.assign(this, args);
      }
    }
    Structural2.prototype = StructuralPrototype;
    return Structural2;
  }();
});

// node_modules/effect/dist/esm/internal/differ/chunkPatch.js
function variance(a) {
  return a;
}
var ChunkPatchTypeId, PatchProto;
var init_chunkPatch = __esm(() => {
  init_Chunk();
  init_Equal();
  init_Function();
  init_Function();
  init_data();
  ChunkPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferChunkPatch");
  PatchProto = {
    ...Structural.prototype,
    [ChunkPatchTypeId]: {
      _Value: variance,
      _Patch: variance
    }
  };
});

// node_modules/effect/dist/esm/internal/differ/contextPatch.js
function variance2(a) {
  return a;
}
var ContextPatchTypeId, PatchProto2, EmptyProto, _empty5, empty11 = () => _empty5, AndThenProto, makeAndThen = (first, second) => {
  const o = Object.create(AndThenProto);
  o.first = first;
  o.second = second;
  return o;
}, AddServiceProto, makeAddService = (key, service) => {
  const o = Object.create(AddServiceProto);
  o.key = key;
  o.service = service;
  return o;
}, RemoveServiceProto, makeRemoveService = (key) => {
  const o = Object.create(RemoveServiceProto);
  o.key = key;
  return o;
}, UpdateServiceProto, makeUpdateService = (key, update) => {
  const o = Object.create(UpdateServiceProto);
  o.key = key;
  o.update = update;
  return o;
}, diff = (oldValue, newValue) => {
  const missingServices = new Map(oldValue.unsafeMap);
  let patch = empty11();
  for (const [tag, newService] of newValue.unsafeMap.entries()) {
    if (missingServices.has(tag)) {
      const old = missingServices.get(tag);
      missingServices.delete(tag);
      if (!equals(old, newService)) {
        patch = combine4(makeUpdateService(tag, () => newService))(patch);
      }
    } else {
      missingServices.delete(tag);
      patch = combine4(makeAddService(tag, newService))(patch);
    }
  }
  for (const [tag] of missingServices.entries()) {
    patch = combine4(makeRemoveService(tag))(patch);
  }
  return patch;
}, combine4, patch;
var init_contextPatch = __esm(() => {
  init_Chunk();
  init_Equal();
  init_Function();
  init_context();
  init_data();
  ContextPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferContextPatch");
  PatchProto2 = {
    ...Structural.prototype,
    [ContextPatchTypeId]: {
      _Value: variance2,
      _Patch: variance2
    }
  };
  EmptyProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "Empty"
  });
  _empty5 = /* @__PURE__ */ Object.create(EmptyProto);
  AndThenProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "AndThen"
  });
  AddServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "AddService"
  });
  RemoveServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "RemoveService"
  });
  UpdateServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "UpdateService"
  });
  combine4 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen(self, that));
  patch = /* @__PURE__ */ dual(2, (self, context) => {
    if (self._tag === "Empty") {
      return context;
    }
    let wasServiceUpdated = false;
    let patches = of2(self);
    const updatedContext = new Map(context.unsafeMap);
    while (isNonEmpty2(patches)) {
      const head3 = headNonEmpty2(patches);
      const tail = tailNonEmpty2(patches);
      switch (head3._tag) {
        case "Empty": {
          patches = tail;
          break;
        }
        case "AddService": {
          updatedContext.set(head3.key, head3.service);
          patches = tail;
          break;
        }
        case "AndThen": {
          patches = prepend2(prepend2(tail, head3.second), head3.first);
          break;
        }
        case "RemoveService": {
          updatedContext.delete(head3.key);
          patches = tail;
          break;
        }
        case "UpdateService": {
          updatedContext.set(head3.key, head3.update(updatedContext.get(head3.key)));
          wasServiceUpdated = true;
          patches = tail;
          break;
        }
      }
    }
    if (!wasServiceUpdated) {
      return makeContext(updatedContext);
    }
    const map7 = new Map;
    for (const [tag] of context.unsafeMap) {
      if (updatedContext.has(tag)) {
        map7.set(tag, updatedContext.get(tag));
        updatedContext.delete(tag);
      }
    }
    for (const [tag, s] of updatedContext) {
      map7.set(tag, s);
    }
    return makeContext(map7);
  });
});

// node_modules/effect/dist/esm/internal/differ/hashMapPatch.js
function variance3(a) {
  return a;
}
var HashMapPatchTypeId, PatchProto3;
var init_hashMapPatch = __esm(() => {
  init_Chunk();
  init_Equal();
  init_Function();
  init_HashMap();
  init_data();
  HashMapPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferHashMapPatch");
  PatchProto3 = {
    ...Structural.prototype,
    [HashMapPatchTypeId]: {
      _Value: variance3,
      _Key: variance3,
      _Patch: variance3
    }
  };
});

// node_modules/effect/dist/esm/internal/differ/hashSetPatch.js
function variance4(a) {
  return a;
}
var HashSetPatchTypeId, PatchProto4, EmptyProto2, _empty6, empty12 = () => _empty6, AndThenProto2, makeAndThen2 = (first, second) => {
  const o = Object.create(AndThenProto2);
  o.first = first;
  o.second = second;
  return o;
}, AddProto, makeAdd = (value) => {
  const o = Object.create(AddProto);
  o.value = value;
  return o;
}, RemoveProto, makeRemove = (value) => {
  const o = Object.create(RemoveProto);
  o.value = value;
  return o;
}, diff2 = (oldValue, newValue) => {
  const [removed, patch2] = reduce4([oldValue, empty12()], ([set4, patch3], value) => {
    if (has3(value)(set4)) {
      return [remove4(value)(set4), patch3];
    }
    return [set4, combine5(makeAdd(value))(patch3)];
  })(newValue);
  return reduce4(patch2, (patch3, value) => combine5(makeRemove(value))(patch3))(removed);
}, combine5, patch2;
var init_hashSetPatch = __esm(() => {
  init_Chunk();
  init_Function();
  init_HashSet();
  init_data();
  HashSetPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferHashSetPatch");
  PatchProto4 = {
    ...Structural.prototype,
    [HashSetPatchTypeId]: {
      _Value: variance4,
      _Key: variance4,
      _Patch: variance4
    }
  };
  EmptyProto2 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto4), {
    _tag: "Empty"
  });
  _empty6 = /* @__PURE__ */ Object.create(EmptyProto2);
  AndThenProto2 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto4), {
    _tag: "AndThen"
  });
  AddProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto4), {
    _tag: "Add"
  });
  RemoveProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto4), {
    _tag: "Remove"
  });
  combine5 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen2(self, that));
  patch2 = /* @__PURE__ */ dual(2, (self, oldValue) => {
    if (self._tag === "Empty") {
      return oldValue;
    }
    let set4 = oldValue;
    let patches = of2(self);
    while (isNonEmpty2(patches)) {
      const head3 = headNonEmpty2(patches);
      const tail = tailNonEmpty2(patches);
      switch (head3._tag) {
        case "Empty": {
          patches = tail;
          break;
        }
        case "AndThen": {
          patches = prepend2(head3.first)(prepend2(head3.second)(tail));
          break;
        }
        case "Add": {
          set4 = add4(head3.value)(set4);
          patches = tail;
          break;
        }
        case "Remove": {
          set4 = remove4(head3.value)(set4);
          patches = tail;
        }
      }
    }
    return set4;
  });
});

// node_modules/effect/dist/esm/internal/differ/orPatch.js
function variance5(a) {
  return a;
}
var OrPatchTypeId, PatchProto5;
var init_orPatch = __esm(() => {
  init_Chunk();
  init_Either();
  init_Equal();
  init_Function();
  init_data();
  OrPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferOrPatch");
  PatchProto5 = {
    ...Structural.prototype,
    [OrPatchTypeId]: {
      _Value: variance5,
      _Key: variance5,
      _Patch: variance5
    }
  };
});

// node_modules/effect/dist/esm/internal/differ/readonlyArrayPatch.js
function variance6(a) {
  return a;
}
var ReadonlyArrayPatchTypeId, PatchProto6, EmptyProto3, _empty7, empty13 = () => _empty7, AndThenProto3, makeAndThen3 = (first, second) => {
  const o = Object.create(AndThenProto3);
  o.first = first;
  o.second = second;
  return o;
}, AppendProto, makeAppend = (values3) => {
  const o = Object.create(AppendProto);
  o.values = values3;
  return o;
}, SliceProto, makeSlice = (from, until) => {
  const o = Object.create(SliceProto);
  o.from = from;
  o.until = until;
  return o;
}, UpdateProto, makeUpdate = (index, patch3) => {
  const o = Object.create(UpdateProto);
  o.index = index;
  o.patch = patch3;
  return o;
}, diff3 = (options) => {
  let i = 0;
  let patch3 = empty13();
  while (i < options.oldValue.length && i < options.newValue.length) {
    const oldElement = options.oldValue[i];
    const newElement = options.newValue[i];
    const valuePatch = options.differ.diff(oldElement, newElement);
    if (!equals(valuePatch, options.differ.empty)) {
      patch3 = combine6(patch3, makeUpdate(i, valuePatch));
    }
    i = i + 1;
  }
  if (i < options.oldValue.length) {
    patch3 = combine6(patch3, makeSlice(0, i));
  }
  if (i < options.newValue.length) {
    patch3 = combine6(patch3, makeAppend(drop(i)(options.newValue)));
  }
  return patch3;
}, combine6, patch3;
var init_readonlyArrayPatch = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_data();
  ReadonlyArrayPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferReadonlyArrayPatch");
  PatchProto6 = {
    ...Structural.prototype,
    [ReadonlyArrayPatchTypeId]: {
      _Value: variance6,
      _Patch: variance6
    }
  };
  EmptyProto3 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto6), {
    _tag: "Empty"
  });
  _empty7 = /* @__PURE__ */ Object.create(EmptyProto3);
  AndThenProto3 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto6), {
    _tag: "AndThen"
  });
  AppendProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto6), {
    _tag: "Append"
  });
  SliceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto6), {
    _tag: "Slice"
  });
  UpdateProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto6), {
    _tag: "Update"
  });
  combine6 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen3(self, that));
  patch3 = /* @__PURE__ */ dual(3, (self, oldValue, differ) => {
    if (self._tag === "Empty") {
      return oldValue;
    }
    let readonlyArray = oldValue.slice();
    let patches = of(self);
    while (isNonEmptyArray2(patches)) {
      const head3 = headNonEmpty(patches);
      const tail = tailNonEmpty(patches);
      switch (head3._tag) {
        case "Empty": {
          patches = tail;
          break;
        }
        case "AndThen": {
          tail.unshift(head3.first, head3.second);
          patches = tail;
          break;
        }
        case "Append": {
          for (const value of head3.values) {
            readonlyArray.push(value);
          }
          patches = tail;
          break;
        }
        case "Slice": {
          readonlyArray = readonlyArray.slice(head3.from, head3.until);
          patches = tail;
          break;
        }
        case "Update": {
          readonlyArray[head3.index] = differ.patch(head3.patch, readonlyArray[head3.index]);
          patches = tail;
          break;
        }
      }
    }
    return readonlyArray;
  });
});

// node_modules/effect/dist/esm/internal/differ.js
var DifferTypeId, DifferProto, make15 = (params) => {
  const differ = Object.create(DifferProto);
  differ.empty = params.empty;
  differ.diff = params.diff;
  differ.combine = params.combine;
  differ.patch = params.patch;
  return differ;
}, environment = () => make15({
  empty: empty11(),
  combine: (first, second) => combine4(second)(first),
  diff: (oldValue, newValue) => diff(oldValue, newValue),
  patch: (patch7, oldValue) => patch(oldValue)(patch7)
}), hashSet = () => make15({
  empty: empty12(),
  combine: (first, second) => combine5(second)(first),
  diff: (oldValue, newValue) => diff2(oldValue, newValue),
  patch: (patch7, oldValue) => patch2(oldValue)(patch7)
}), readonlyArray = (differ) => make15({
  empty: empty13(),
  combine: (first, second) => combine6(first, second),
  diff: (oldValue, newValue) => diff3({
    oldValue,
    newValue,
    differ
  }),
  patch: (patch7, oldValue) => patch3(patch7, oldValue, differ)
}), update = () => updateWith((_, a) => a), updateWith = (f) => make15({
  empty: identity,
  combine: (first, second) => {
    if (first === identity) {
      return second;
    }
    if (second === identity) {
      return first;
    }
    return (a) => second(first(a));
  },
  diff: (oldValue, newValue) => {
    if (equals(oldValue, newValue)) {
      return identity;
    }
    return constant(newValue);
  },
  patch: (patch7, oldValue) => f(oldValue, patch7(oldValue))
});
var init_differ = __esm(() => {
  init_Equal();
  init_Function();
  init_Function();
  init_chunkPatch();
  init_contextPatch();
  init_hashMapPatch();
  init_hashSetPatch();
  init_orPatch();
  init_readonlyArrayPatch();
  DifferTypeId = /* @__PURE__ */ Symbol.for("effect/Differ");
  DifferProto = {
    [DifferTypeId]: {
      _P: identity,
      _V: identity
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/runtimeFlagsPatch.js
var BIT_MASK = 255, BIT_SHIFT = 8, active = (patch7) => patch7 & BIT_MASK, enabled = (patch7) => patch7 >> BIT_SHIFT & BIT_MASK, make16 = (active2, enabled2) => (active2 & BIT_MASK) + ((enabled2 & active2 & BIT_MASK) << BIT_SHIFT), empty17, enable = (flag) => make16(flag, flag), disable = (flag) => make16(flag, 0), exclude, andThen, invert = (n) => ~n >>> 0 & BIT_MASK;
var init_runtimeFlagsPatch = __esm(() => {
  init_Function();
  empty17 = /* @__PURE__ */ make16(0, 0);
  exclude = /* @__PURE__ */ dual(2, (self, flag) => make16(active(self) & ~flag, enabled(self)));
  andThen = /* @__PURE__ */ dual(2, (self, that) => self | that);
});

// node_modules/effect/dist/esm/internal/runtimeFlags.js
var None2 = 0, Interruption, OpSupervision, RuntimeMetrics, WindDown, CooperativeYielding, cooperativeYielding = (self) => isEnabled(self, CooperativeYielding), enable2, interruptible = (self) => interruption(self) && !windDown(self), interruption = (self) => isEnabled(self, Interruption), isEnabled, make17 = (...flags) => flags.reduce((a, b) => a | b, 0), none5, runtimeMetrics = (self) => isEnabled(self, RuntimeMetrics), windDown = (self) => isEnabled(self, WindDown), diff7, patch7, differ;
var init_runtimeFlags = __esm(() => {
  init_Function();
  init_differ();
  init_runtimeFlagsPatch();
  Interruption = 1 << 0;
  OpSupervision = 1 << 1;
  RuntimeMetrics = 1 << 2;
  WindDown = 1 << 4;
  CooperativeYielding = 1 << 5;
  enable2 = /* @__PURE__ */ dual(2, (self, flag) => self | flag);
  isEnabled = /* @__PURE__ */ dual(2, (self, flag) => (self & flag) !== 0);
  none5 = /* @__PURE__ */ make17(None2);
  diff7 = /* @__PURE__ */ dual(2, (self, that) => make16(self ^ that, that));
  patch7 = /* @__PURE__ */ dual(2, (self, patch8) => self & (invert(active(patch8)) | enabled(patch8)) | active(patch8) & enabled(patch8));
  differ = /* @__PURE__ */ make15({
    empty: empty17,
    diff: (oldValue, newValue) => diff7(oldValue, newValue),
    combine: (first, second) => andThen(second)(first),
    patch: (_patch, oldValue) => patch7(oldValue, _patch)
  });
});

// node_modules/effect/dist/esm/RuntimeFlagsPatch.js
var empty18, enable3, disable2, exclude2;
var init_RuntimeFlagsPatch = __esm(() => {
  init_runtimeFlags();
  init_runtimeFlagsPatch();
  empty18 = empty17;
  enable3 = enable;
  disable2 = disable;
  exclude2 = exclude;
});

// node_modules/effect/dist/esm/internal/blockedRequests.js
var empty19, par = (self, that) => ({
  _tag: "Par",
  left: self,
  right: that
}), seq = (self, that) => ({
  _tag: "Seq",
  left: self,
  right: that
}), single = (dataSource, blockedRequest) => ({
  _tag: "Single",
  dataSource,
  blockedRequest
}), flatten3 = (self) => {
  let current = of3(self);
  let updated = empty10();
  while (true) {
    const [parallel, sequential] = reduce6(current, [parallelCollectionEmpty(), empty10()], ([parallel2, sequential2], blockedRequest) => {
      const [par2, seq2] = step(blockedRequest);
      return [parallelCollectionCombine(parallel2, par2), appendAll3(sequential2, seq2)];
    });
    updated = merge4(updated, parallel);
    if (isNil(sequential)) {
      return reverse3(updated);
    }
    current = sequential;
  }
  throw new Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, step = (requests) => {
  let current = requests;
  let parallel = parallelCollectionEmpty();
  let stack = empty10();
  let sequential = empty10();
  while (true) {
    switch (current._tag) {
      case "Empty": {
        if (isNil(stack)) {
          return [parallel, sequential];
        }
        current = stack.head;
        stack = stack.tail;
        break;
      }
      case "Par": {
        stack = cons(current.right, stack);
        current = current.left;
        break;
      }
      case "Seq": {
        const left3 = current.left;
        const right3 = current.right;
        switch (left3._tag) {
          case "Empty": {
            current = right3;
            break;
          }
          case "Par": {
            const l = left3.left;
            const r = left3.right;
            current = par(seq(l, right3), seq(r, right3));
            break;
          }
          case "Seq": {
            const l = left3.left;
            const r = left3.right;
            current = seq(l, seq(r, right3));
            break;
          }
          case "Single": {
            current = left3;
            sequential = cons(right3, sequential);
            break;
          }
        }
        break;
      }
      case "Single": {
        parallel = parallelCollectionAdd(parallel, current);
        if (isNil(stack)) {
          return [parallel, sequential];
        }
        current = stack.head;
        stack = stack.tail;
        break;
      }
    }
  }
  throw new Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, merge4 = (sequential, parallel) => {
  if (isNil(sequential)) {
    return of3(parallelCollectionToSequentialCollection(parallel));
  }
  if (parallelCollectionIsEmpty(parallel)) {
    return sequential;
  }
  const seqHeadKeys = sequentialCollectionKeys(sequential.head);
  const parKeys = parallelCollectionKeys(parallel);
  if (seqHeadKeys.length === 1 && parKeys.length === 1 && equals(seqHeadKeys[0], parKeys[0])) {
    return cons(sequentialCollectionCombine(sequential.head, parallelCollectionToSequentialCollection(parallel)), sequential.tail);
  }
  return cons(parallelCollectionToSequentialCollection(parallel), sequential);
}, EntryTypeId, EntryImpl, blockedRequestVariance, makeEntry = (options) => new EntryImpl(options.request, options.result, options.listeners, options.ownerId, options.state), RequestBlockParallelTypeId, parallelVariance, ParallelImpl, parallelCollectionEmpty = () => new ParallelImpl(empty9()), parallelCollectionAdd = (self, blockedRequest) => new ParallelImpl(modifyAt2(self.map, blockedRequest.dataSource, (_) => orElseSome(map2(_, append2(blockedRequest.blockedRequest)), () => of2(blockedRequest.blockedRequest)))), parallelCollectionCombine = (self, that) => new ParallelImpl(reduce5(self.map, that.map, (map7, value, key) => set3(map7, key, match2(get7(map7, key), {
  onNone: () => value,
  onSome: (other) => appendAll2(value, other)
})))), parallelCollectionIsEmpty = (self) => isEmpty3(self.map), parallelCollectionKeys = (self) => Array.from(keys2(self.map)), parallelCollectionToSequentialCollection = (self) => sequentialCollectionMake(map6(self.map, (x) => of2(x))), SequentialCollectionTypeId, sequentialVariance, SequentialImpl, sequentialCollectionMake = (map7) => new SequentialImpl(map7), sequentialCollectionCombine = (self, that) => new SequentialImpl(reduce5(that.map, self.map, (map7, value, key) => set3(map7, key, match2(get7(map7, key), {
  onNone: () => empty5(),
  onSome: (a) => appendAll2(a, value)
})))), sequentialCollectionKeys = (self) => Array.from(keys2(self.map)), sequentialCollectionToChunk = (self) => Array.from(self.map);
var init_blockedRequests = __esm(() => {
  init_Chunk();
  init_Either();
  init_Equal();
  init_HashMap();
  init_List();
  init_Option();
  init_Predicate();
  empty19 = {
    _tag: "Empty"
  };
  EntryTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/Entry");
  EntryImpl = class EntryImpl {
    request;
    result;
    listeners;
    ownerId;
    state;
    [EntryTypeId] = blockedRequestVariance;
    constructor(request, result, listeners, ownerId, state) {
      this.request = request;
      this.result = result;
      this.listeners = listeners;
      this.ownerId = ownerId;
      this.state = state;
    }
  };
  blockedRequestVariance = {
    _R: (_) => _
  };
  RequestBlockParallelTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/RequestBlockParallel");
  parallelVariance = {
    _R: (_) => _
  };
  ParallelImpl = class ParallelImpl {
    map;
    [RequestBlockParallelTypeId] = parallelVariance;
    constructor(map7) {
      this.map = map7;
    }
  };
  SequentialCollectionTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/RequestBlockSequential");
  sequentialVariance = {
    _R: (_) => _
  };
  SequentialImpl = class SequentialImpl {
    map;
    [SequentialCollectionTypeId] = sequentialVariance;
    constructor(map7) {
      this.map = map7;
    }
  };
});

// node_modules/effect/dist/esm/internal/opCodes/cause.js
var OP_DIE = "Die", OP_EMPTY = "Empty", OP_FAIL = "Fail", OP_INTERRUPT = "Interrupt", OP_PARALLEL = "Parallel", OP_SEQUENTIAL = "Sequential";

// node_modules/effect/dist/esm/internal/cause.js
var CauseSymbolKey = "effect/Cause", CauseTypeId, variance7, proto, empty20, fail = (error) => {
  const o = Object.create(proto);
  o._tag = OP_FAIL;
  o.error = error;
  return o;
}, die = (defect) => {
  const o = Object.create(proto);
  o._tag = OP_DIE;
  o.defect = defect;
  return o;
}, interrupt = (fiberId) => {
  const o = Object.create(proto);
  o._tag = OP_INTERRUPT;
  o.fiberId = fiberId;
  return o;
}, parallel = (left3, right3) => {
  const o = Object.create(proto);
  o._tag = OP_PARALLEL;
  o.left = left3;
  o.right = right3;
  return o;
}, sequential = (left3, right3) => {
  const o = Object.create(proto);
  o._tag = OP_SEQUENTIAL;
  o.left = left3;
  o.right = right3;
  return o;
}, isCause = (u) => hasProperty(u, CauseTypeId), isEmptyType = (self) => self._tag === OP_EMPTY, isFailType = (self) => self._tag === OP_FAIL, isDieType = (self) => self._tag === OP_DIE, isEmpty5 = (self) => {
  if (self._tag === OP_EMPTY) {
    return true;
  }
  return reduce7(self, true, (acc, cause) => {
    switch (cause._tag) {
      case OP_EMPTY: {
        return some2(acc);
      }
      case OP_DIE:
      case OP_FAIL:
      case OP_INTERRUPT: {
        return some2(false);
      }
      default: {
        return none2();
      }
    }
  });
}, isInterrupted = (self) => isSome2(interruptOption(self)), isInterruptedOnly = (self) => reduceWithContext(undefined, IsInterruptedOnlyCauseReducer)(self), failures = (self) => reverse2(reduce7(self, empty5(), (list, cause) => cause._tag === OP_FAIL ? some2(pipe(list, prepend2(cause.error))) : none2())), defects = (self) => reverse2(reduce7(self, empty5(), (list, cause) => cause._tag === OP_DIE ? some2(pipe(list, prepend2(cause.defect))) : none2())), interruptors = (self) => reduce7(self, empty8(), (set4, cause) => cause._tag === OP_INTERRUPT ? some2(pipe(set4, add4(cause.fiberId))) : none2()), failureOption = (self) => find(self, (cause) => cause._tag === OP_FAIL ? some2(cause.error) : none2()), failureOrCause = (self) => {
  const option = failureOption(self);
  switch (option._tag) {
    case "None": {
      return right2(self);
    }
    case "Some": {
      return left2(option.value);
    }
  }
}, interruptOption = (self) => find(self, (cause) => cause._tag === OP_INTERRUPT ? some2(cause.fiberId) : none2()), keepDefects = (self) => match5(self, {
  onEmpty: none2(),
  onFail: () => none2(),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: () => none2(),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
}), keepDefectsAndElectFailures = (self) => match5(self, {
  onEmpty: none2(),
  onFail: (failure) => some2(die(failure)),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: () => none2(),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
}), stripFailures = (self) => match5(self, {
  onEmpty: empty20,
  onFail: () => empty20,
  onDie: die,
  onInterrupt: interrupt,
  onSequential: sequential,
  onParallel: parallel
}), electFailures = (self) => match5(self, {
  onEmpty: empty20,
  onFail: die,
  onDie: die,
  onInterrupt: interrupt,
  onSequential: sequential,
  onParallel: parallel
}), flatMap6, flatten4 = (self) => flatMap6(self, identity), causeEquals = (left3, right3) => {
  let leftStack = of2(left3);
  let rightStack = of2(right3);
  while (isNonEmpty2(leftStack) && isNonEmpty2(rightStack)) {
    const [leftParallel, leftSequential] = pipe(headNonEmpty2(leftStack), reduce7([empty8(), empty5()], ([parallel2, sequential2], cause) => {
      const [par2, seq2] = evaluateCause(cause);
      return some2([pipe(parallel2, union3(par2)), pipe(sequential2, appendAll2(seq2))]);
    }));
    const [rightParallel, rightSequential] = pipe(headNonEmpty2(rightStack), reduce7([empty8(), empty5()], ([parallel2, sequential2], cause) => {
      const [par2, seq2] = evaluateCause(cause);
      return some2([pipe(parallel2, union3(par2)), pipe(sequential2, appendAll2(seq2))]);
    }));
    if (!equals(leftParallel, rightParallel)) {
      return false;
    }
    leftStack = leftSequential;
    rightStack = rightSequential;
  }
  return true;
}, flattenCause = (cause) => {
  return flattenCauseLoop(of2(cause), empty5());
}, flattenCauseLoop = (causes, flattened) => {
  while (true) {
    const [parallel2, sequential2] = pipe(causes, reduce([empty8(), empty5()], ([parallel3, sequential3], cause) => {
      const [par2, seq2] = evaluateCause(cause);
      return [pipe(parallel3, union3(par2)), pipe(sequential3, appendAll2(seq2))];
    }));
    const updated = size3(parallel2) > 0 ? pipe(flattened, prepend2(parallel2)) : flattened;
    if (isEmpty(sequential2)) {
      return reverse2(updated);
    }
    causes = sequential2;
    flattened = updated;
  }
  throw new Error(getBugErrorMessage("Cause.flattenCauseLoop"));
}, find, evaluateCause = (self) => {
  let cause = self;
  const stack = [];
  let _parallel = empty8();
  let _sequential = empty5();
  while (cause !== undefined) {
    switch (cause._tag) {
      case OP_EMPTY: {
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_FAIL: {
        _parallel = add4(_parallel, make7(cause._tag, cause.error));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_DIE: {
        _parallel = add4(_parallel, make7(cause._tag, cause.defect));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_INTERRUPT: {
        _parallel = add4(_parallel, make7(cause._tag, cause.fiberId));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_SEQUENTIAL: {
        switch (cause.left._tag) {
          case OP_EMPTY: {
            cause = cause.right;
            break;
          }
          case OP_SEQUENTIAL: {
            cause = sequential(cause.left.left, sequential(cause.left.right, cause.right));
            break;
          }
          case OP_PARALLEL: {
            cause = parallel(sequential(cause.left.left, cause.right), sequential(cause.left.right, cause.right));
            break;
          }
          default: {
            _sequential = prepend2(_sequential, cause.right);
            cause = cause.left;
            break;
          }
        }
        break;
      }
      case OP_PARALLEL: {
        stack.push(cause.right);
        cause = cause.left;
        break;
      }
    }
  }
  throw new Error(getBugErrorMessage("Cause.evaluateCauseLoop"));
}, IsInterruptedOnlyCauseReducer, OP_SEQUENTIAL_CASE = "SequentialCase", OP_PARALLEL_CASE = "ParallelCase", match5, reduce7, reduceWithContext, pretty = (cause, options) => {
  if (isInterruptedOnly(cause)) {
    return "All fibers interrupted without errors.";
  }
  return prettyErrors(cause).map(function(e) {
    if (options?.renderErrorCause !== true || e.cause === undefined) {
      return e.stack;
    }
    return `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}`;
  }).join(`
`);
}, renderErrorCause = (cause, prefix) => {
  const lines = cause.stack.split(`
`);
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length;i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause.cause) {
    stack += ` {
${renderErrorCause(cause.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
}, PrettyError, prettyErrorMessage = (u) => {
  if (typeof u === "string") {
    return u;
  }
  if (typeof u === "object" && u !== null && u instanceof Error) {
    return u.message;
  }
  try {
    if (hasProperty(u, "toString") && isFunction2(u["toString"]) && u["toString"] !== Object.prototype.toString && u["toString"] !== globalThis.Array.prototype.toString) {
      return u["toString"]();
    }
  } catch {}
  return stringifyCircular(u);
}, locationRegex, spanToTrace, prettyErrorStack = (message, stack, span2) => {
  const out = [message];
  const lines = stack.startsWith(message) ? stack.slice(message.length).split(`
`) : stack.split(`
`);
  for (let i = 1;i < lines.length; i++) {
    if (lines[i].includes("Generator.next")) {
      break;
    }
    if (lines[i].includes("effect_internal_function")) {
      out.pop();
      break;
    }
    out.push(lines[i].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
  }
  if (span2) {
    let current = span2;
    let i = 0;
    while (current && current._tag === "Span" && i < 10) {
      const stackFn = spanToTrace.get(current);
      if (typeof stackFn === "function") {
        const stack2 = stackFn();
        if (typeof stack2 === "string") {
          const locationMatchAll = stack2.matchAll(locationRegex);
          let match6 = false;
          for (const [, location] of locationMatchAll) {
            match6 = true;
            out.push(`    at ${current.name} (${location})`);
          }
          if (!match6) {
            out.push(`    at ${current.name} (${stack2.replace(/^at /, "")})`);
          }
        } else {
          out.push(`    at ${current.name}`);
        }
      } else {
        out.push(`    at ${current.name}`);
      }
      current = getOrUndefined(current.parent);
      i++;
    }
  }
  return out.join(`
`);
}, spanSymbol, prettyErrors = (cause) => reduceWithContext(cause, undefined, {
  emptyCase: () => [],
  dieCase: (_, unknownError) => {
    return [new PrettyError(unknownError)];
  },
  failCase: (_, error) => {
    return [new PrettyError(error)];
  },
  interruptCase: () => [],
  parallelCase: (_, l, r) => [...l, ...r],
  sequentialCase: (_, l, r) => [...l, ...r]
});
var init_cause = __esm(() => {
  init_Array();
  init_Chunk();
  init_Either();
  init_Equal();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_HashSet();
  init_Inspectable();
  init_Option();
  init_Predicate();
  CauseTypeId = /* @__PURE__ */ Symbol.for(CauseSymbolKey);
  variance7 = {
    _E: (_) => _
  };
  proto = {
    [CauseTypeId]: variance7,
    [symbol]() {
      return pipe(hash(CauseSymbolKey), combine(hash(flattenCause(this))), cached(this));
    },
    [symbol2](that) {
      return isCause(that) && causeEquals(this, that);
    },
    pipe() {
      return pipeArguments(this, arguments);
    },
    toJSON() {
      switch (this._tag) {
        case "Empty":
          return {
            _id: "Cause",
            _tag: this._tag
          };
        case "Die":
          return {
            _id: "Cause",
            _tag: this._tag,
            defect: toJSON(this.defect)
          };
        case "Interrupt":
          return {
            _id: "Cause",
            _tag: this._tag,
            fiberId: this.fiberId.toJSON()
          };
        case "Fail":
          return {
            _id: "Cause",
            _tag: this._tag,
            failure: toJSON(this.error)
          };
        case "Sequential":
        case "Parallel":
          return {
            _id: "Cause",
            _tag: this._tag,
            left: toJSON(this.left),
            right: toJSON(this.right)
          };
      }
    },
    toString() {
      return pretty(this);
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  empty20 = /* @__PURE__ */ (() => {
    const o = /* @__PURE__ */ Object.create(proto);
    o._tag = OP_EMPTY;
    return o;
  })();
  flatMap6 = /* @__PURE__ */ dual(2, (self, f) => match5(self, {
    onEmpty: empty20,
    onFail: (error) => f(error),
    onDie: (defect) => die(defect),
    onInterrupt: (fiberId) => interrupt(fiberId),
    onSequential: (left3, right3) => sequential(left3, right3),
    onParallel: (left3, right3) => parallel(left3, right3)
  }));
  find = /* @__PURE__ */ dual(2, (self, pf) => {
    const stack = [self];
    while (stack.length > 0) {
      const item = stack.pop();
      const option = pf(item);
      switch (option._tag) {
        case "None": {
          switch (item._tag) {
            case OP_SEQUENTIAL:
            case OP_PARALLEL: {
              stack.push(item.right);
              stack.push(item.left);
              break;
            }
          }
          break;
        }
        case "Some": {
          return option;
        }
      }
    }
    return none2();
  });
  IsInterruptedOnlyCauseReducer = {
    emptyCase: constTrue,
    failCase: constFalse,
    dieCase: constFalse,
    interruptCase: constTrue,
    sequentialCase: (_, left3, right3) => left3 && right3,
    parallelCase: (_, left3, right3) => left3 && right3
  };
  match5 = /* @__PURE__ */ dual(2, (self, {
    onDie,
    onEmpty,
    onFail,
    onInterrupt,
    onParallel,
    onSequential
  }) => {
    return reduceWithContext(self, undefined, {
      emptyCase: () => onEmpty,
      failCase: (_, error) => onFail(error),
      dieCase: (_, defect) => onDie(defect),
      interruptCase: (_, fiberId) => onInterrupt(fiberId),
      sequentialCase: (_, left3, right3) => onSequential(left3, right3),
      parallelCase: (_, left3, right3) => onParallel(left3, right3)
    });
  });
  reduce7 = /* @__PURE__ */ dual(3, (self, zero3, pf) => {
    let accumulator = zero3;
    let cause = self;
    const causes = [];
    while (cause !== undefined) {
      const option = pf(accumulator, cause);
      accumulator = isSome2(option) ? option.value : accumulator;
      switch (cause._tag) {
        case OP_SEQUENTIAL: {
          causes.push(cause.right);
          cause = cause.left;
          break;
        }
        case OP_PARALLEL: {
          causes.push(cause.right);
          cause = cause.left;
          break;
        }
        default: {
          cause = undefined;
          break;
        }
      }
      if (cause === undefined && causes.length > 0) {
        cause = causes.pop();
      }
    }
    return accumulator;
  });
  reduceWithContext = /* @__PURE__ */ dual(3, (self, context, reducer) => {
    const input = [self];
    const output = [];
    while (input.length > 0) {
      const cause = input.pop();
      switch (cause._tag) {
        case OP_EMPTY: {
          output.push(right2(reducer.emptyCase(context)));
          break;
        }
        case OP_FAIL: {
          output.push(right2(reducer.failCase(context, cause.error)));
          break;
        }
        case OP_DIE: {
          output.push(right2(reducer.dieCase(context, cause.defect)));
          break;
        }
        case OP_INTERRUPT: {
          output.push(right2(reducer.interruptCase(context, cause.fiberId)));
          break;
        }
        case OP_SEQUENTIAL: {
          input.push(cause.right);
          input.push(cause.left);
          output.push(left2({
            _tag: OP_SEQUENTIAL_CASE
          }));
          break;
        }
        case OP_PARALLEL: {
          input.push(cause.right);
          input.push(cause.left);
          output.push(left2({
            _tag: OP_PARALLEL_CASE
          }));
          break;
        }
      }
    }
    const accumulator = [];
    while (output.length > 0) {
      const either2 = output.pop();
      switch (either2._tag) {
        case "Left": {
          switch (either2.left._tag) {
            case OP_SEQUENTIAL_CASE: {
              const left3 = accumulator.pop();
              const right3 = accumulator.pop();
              const value = reducer.sequentialCase(context, left3, right3);
              accumulator.push(value);
              break;
            }
            case OP_PARALLEL_CASE: {
              const left3 = accumulator.pop();
              const right3 = accumulator.pop();
              const value = reducer.parallelCase(context, left3, right3);
              accumulator.push(value);
              break;
            }
          }
          break;
        }
        case "Right": {
          accumulator.push(either2.right);
          break;
        }
      }
    }
    if (accumulator.length === 0) {
      throw new Error("BUG: Cause.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
    }
    return accumulator.pop();
  });
  PrettyError = class PrettyError extends globalThis.Error {
    span = undefined;
    constructor(originalError) {
      const originalErrorIsObject = typeof originalError === "object" && originalError !== null;
      const prevLimit = Error.stackTraceLimit;
      Error.stackTraceLimit = 1;
      super(prettyErrorMessage(originalError), originalErrorIsObject && "cause" in originalError && typeof originalError.cause !== "undefined" ? {
        cause: new PrettyError(originalError.cause)
      } : undefined);
      if (this.message === "") {
        this.message = "An error has occurred";
      }
      Error.stackTraceLimit = prevLimit;
      this.name = originalError instanceof Error ? originalError.name : "Error";
      if (originalErrorIsObject) {
        if (spanSymbol in originalError) {
          this.span = originalError[spanSymbol];
        }
        Object.keys(originalError).forEach((key) => {
          if (!(key in this)) {
            this[key] = originalError[key];
          }
        });
      }
      this.stack = prettyErrorStack(`${this.name}: ${this.message}`, originalError instanceof Error && originalError.stack ? originalError.stack : "", this.span);
    }
  };
  locationRegex = /\((.*)\)/g;
  spanToTrace = /* @__PURE__ */ globalValue("effect/Tracer/spanToTrace", () => new WeakMap);
  spanSymbol = /* @__PURE__ */ Symbol.for("effect/SpanAnnotation");
});

// node_modules/effect/dist/esm/internal/opCodes/deferred.js
var OP_STATE_PENDING = "Pending", OP_STATE_DONE = "Done";

// node_modules/effect/dist/esm/internal/deferred.js
var DeferredSymbolKey = "effect/Deferred", DeferredTypeId, deferredVariance, pending = (joiners) => {
  return {
    _tag: OP_STATE_PENDING,
    joiners
  };
}, done = (effect) => {
  return {
    _tag: OP_STATE_DONE,
    effect
  };
};
var init_deferred = __esm(() => {
  DeferredTypeId = /* @__PURE__ */ Symbol.for(DeferredSymbolKey);
  deferredVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
});

// node_modules/effect/dist/esm/internal/singleShotGen.js
var SingleShotGen2;
var init_singleShotGen = __esm(() => {
  SingleShotGen2 = class SingleShotGen2 {
    self;
    called = false;
    constructor(self) {
      this.self = self;
    }
    next(a) {
      return this.called ? {
        value: a,
        done: true
      } : (this.called = true, {
        value: this.self,
        done: false
      });
    }
    return(a) {
      return {
        value: a,
        done: true
      };
    }
    throw(e) {
      throw e;
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(this.self);
    }
  };
});

// node_modules/effect/dist/esm/internal/core.js
class RevertFlags {
  patch;
  op;
  _op = OP_REVERT_FLAGS;
  constructor(patch8, op) {
    this.patch = patch8;
    this.op = op;
  }
}
var blocked = (blockedRequests, _continue) => {
  const effect = new EffectPrimitive("Blocked");
  effect.effect_instruction_i0 = blockedRequests;
  effect.effect_instruction_i1 = _continue;
  return effect;
}, runRequestBlock = (blockedRequests) => {
  const effect = new EffectPrimitive("RunBlocked");
  effect.effect_instruction_i0 = blockedRequests;
  return effect;
}, EffectTypeId2, EffectPrimitive, EffectPrimitiveFailure, EffectPrimitiveSuccess, isEffect = (u) => hasProperty(u, EffectTypeId2), withFiberRuntime = (withRuntime) => {
  const effect = new EffectPrimitive(OP_WITH_RUNTIME);
  effect.effect_instruction_i0 = withRuntime;
  return effect;
}, acquireUseRelease, as, asVoid = (self) => as(self, undefined), custom = function() {
  const wrapper = new EffectPrimitive(OP_COMMIT);
  switch (arguments.length) {
    case 2: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.commit = arguments[1];
      break;
    }
    case 3: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.effect_instruction_i1 = arguments[1];
      wrapper.commit = arguments[2];
      break;
    }
    case 4: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.effect_instruction_i1 = arguments[1];
      wrapper.effect_instruction_i2 = arguments[2];
      wrapper.commit = arguments[3];
      break;
    }
    default: {
      throw new Error(getBugErrorMessage("you're not supposed to end up here"));
    }
  }
  return wrapper;
}, unsafeAsync = (register, blockingOn = none4) => {
  const effect = new EffectPrimitive(OP_ASYNC);
  let cancelerRef = undefined;
  effect.effect_instruction_i0 = (resume) => {
    cancelerRef = register(resume);
  };
  effect.effect_instruction_i1 = blockingOn;
  return onInterrupt(effect, (_) => isEffect(cancelerRef) ? cancelerRef : void_);
}, asyncInterrupt = (register, blockingOn = none4) => suspend(() => unsafeAsync(register, blockingOn)), async_ = (resume, blockingOn = none4) => {
  return custom(resume, function() {
    let backingResume = undefined;
    let pendingEffect = undefined;
    function proxyResume(effect2) {
      if (backingResume) {
        backingResume(effect2);
      } else if (pendingEffect === undefined) {
        pendingEffect = effect2;
      }
    }
    const effect = new EffectPrimitive(OP_ASYNC);
    effect.effect_instruction_i0 = (resume2) => {
      backingResume = resume2;
      if (pendingEffect) {
        resume2(pendingEffect);
      }
    };
    effect.effect_instruction_i1 = blockingOn;
    let cancelerRef = undefined;
    let controllerRef = undefined;
    if (this.effect_instruction_i0.length !== 1) {
      controllerRef = new AbortController;
      cancelerRef = internalCall(() => this.effect_instruction_i0(proxyResume, controllerRef.signal));
    } else {
      cancelerRef = internalCall(() => this.effect_instruction_i0(proxyResume));
    }
    return cancelerRef || controllerRef ? onInterrupt(effect, (_) => {
      if (controllerRef) {
        controllerRef.abort();
      }
      return cancelerRef ?? void_;
    }) : effect;
  });
}, catchAllCause, catchAll, catchIf, catchSome, checkInterruptible = (f) => withFiberRuntime((_, status) => f(interruption(status.runtimeFlags))), originalSymbol, capture = (obj, span2) => {
  if (isSome2(span2)) {
    return new Proxy(obj, {
      has(target, p) {
        return p === spanSymbol || p === originalSymbol || p in target;
      },
      get(target, p) {
        if (p === spanSymbol) {
          return span2.value;
        }
        if (p === originalSymbol) {
          return obj;
        }
        return target[p];
      }
    });
  }
  return obj;
}, die2 = (defect) => isObject(defect) && !(spanSymbol in defect) ? withFiberRuntime((fiber) => failCause(die(capture(defect, currentSpanFromFiber(fiber))))) : failCause(die(defect)), dieMessage = (message) => failCauseSync(() => die(new RuntimeException(message))), dieSync = (evaluate) => flatMap7(sync(evaluate), die2), either2 = (self) => matchEffect(self, {
  onFailure: (e) => succeed(left2(e)),
  onSuccess: (a) => succeed(right2(a))
}), exit = (self) => matchCause(self, {
  onFailure: exitFailCause,
  onSuccess: exitSucceed
}), fail2 = (error) => isObject(error) && !(spanSymbol in error) ? withFiberRuntime((fiber) => failCause(fail(capture(error, currentSpanFromFiber(fiber))))) : failCause(fail(error)), failSync = (evaluate) => flatMap7(sync(evaluate), fail2), failCause = (cause) => {
  const effect = new EffectPrimitiveFailure(OP_FAILURE);
  effect.effect_instruction_i0 = cause;
  return effect;
}, failCauseSync = (evaluate) => flatMap7(sync(evaluate), failCause), fiberId, fiberIdWith = (f) => withFiberRuntime((state) => f(state.id())), flatMap7, andThen2, step2 = (self) => {
  const effect = new EffectPrimitive("OnStep");
  effect.effect_instruction_i0 = self;
  return effect;
}, flatten5 = (self) => flatMap7(self, identity), flip = (self) => matchEffect(self, {
  onFailure: succeed,
  onSuccess: fail2
}), matchCause, matchCauseEffect, matchEffect, forEachSequential, forEachSequentialDiscard, if_, interrupt2, interruptWith = (fiberId2) => failCause(interrupt(fiberId2)), interruptible2 = (self) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = enable3(Interruption);
  effect.effect_instruction_i1 = () => self;
  return effect;
}, interruptibleMask = (f) => custom(f, function() {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = enable3(Interruption);
  effect.effect_instruction_i1 = (oldFlags) => interruption(oldFlags) ? internalCall(() => this.effect_instruction_i0(interruptible2)) : internalCall(() => this.effect_instruction_i0(uninterruptible));
  return effect;
}), intoDeferred, map9, mapBoth, mapError, onError, onExit, onInterrupt, orElse2, orDie = (self) => orDieWith(self, identity), orDieWith, partitionMap2, runtimeFlags, succeed = (value) => {
  const effect = new EffectPrimitiveSuccess(OP_SUCCESS);
  effect.effect_instruction_i0 = value;
  return effect;
}, suspend = (evaluate) => {
  const effect = new EffectPrimitive(OP_COMMIT);
  effect.commit = evaluate;
  return effect;
}, sync = (thunk) => {
  const effect = new EffectPrimitive(OP_SYNC);
  effect.effect_instruction_i0 = thunk;
  return effect;
}, tap, transplant = (f) => withFiberRuntime((state) => {
  const scopeOverride = state.getFiberRef(currentForkScopeOverride);
  const scope = pipe(scopeOverride, getOrElse(() => state.scope()));
  return f(fiberRefLocally(currentForkScopeOverride, some2(scope)));
}), attemptOrElse, uninterruptible = (self) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = disable2(Interruption);
  effect.effect_instruction_i1 = () => self;
  return effect;
}, uninterruptibleMask = (f) => custom(f, function() {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = disable2(Interruption);
  effect.effect_instruction_i1 = (oldFlags) => interruption(oldFlags) ? internalCall(() => this.effect_instruction_i0(interruptible2)) : internalCall(() => this.effect_instruction_i0(uninterruptible));
  return effect;
}), void_, updateRuntimeFlags = (patch8) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = patch8;
  effect.effect_instruction_i1 = undefined;
  return effect;
}, whenEffect, whileLoop = (options) => {
  const effect = new EffectPrimitive(OP_WHILE);
  effect.effect_instruction_i0 = options.while;
  effect.effect_instruction_i1 = options.body;
  effect.effect_instruction_i2 = options.step;
  return effect;
}, fromIterator = (iterator) => suspend(() => {
  const effect = new EffectPrimitive(OP_ITERATOR);
  effect.effect_instruction_i0 = iterator();
  return effect;
}), gen = function() {
  const f = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
  return fromIterator(() => f(pipe));
}, fnUntraced = (body, ...pipeables) => Object.defineProperty(pipeables.length === 0 ? function(...args) {
  return fromIterator(() => body.apply(this, args));
} : function(...args) {
  let effect = fromIterator(() => body.apply(this, args));
  for (const x of pipeables) {
    effect = x(effect, ...args);
  }
  return effect;
}, "length", {
  value: body.length,
  configurable: true
}), withConcurrency, withRequestBatching, withRuntimeFlags, withTracerEnabled, withTracerTiming, yieldNow = (options) => {
  const effect = new EffectPrimitive(OP_YIELD);
  return typeof options?.priority !== "undefined" ? withSchedulingPriority(effect, options.priority) : effect;
}, zip2, zipLeft, zipRight, zipWith2, never, interruptFiber = (self) => flatMap7(fiberId, (fiberId2) => pipe(self, interruptAsFiber(fiberId2))), interruptAsFiber, logLevelAll, logLevelFatal, logLevelError, logLevelWarning, logLevelInfo, logLevelDebug, logLevelTrace, logLevelNone, FiberRefSymbolKey = "effect/FiberRef", FiberRefTypeId, fiberRefVariance, fiberRefGet = (self) => withFiberRuntime((fiber) => exitSucceed(fiber.getFiberRef(self))), fiberRefGetAndSet, fiberRefGetAndUpdate, fiberRefGetAndUpdateSome, fiberRefGetWith, fiberRefSet, fiberRefDelete = (self) => withFiberRuntime((state) => {
  state.unsafeDeleteFiberRef(self);
  return void_;
}), fiberRefReset = (self) => fiberRefSet(self, self.initial), fiberRefModify, fiberRefModifySome = (self, def, f) => fiberRefModify(self, (v) => getOrElse(f(v), () => [def, v])), fiberRefUpdate, fiberRefUpdateSome, fiberRefUpdateAndGet, fiberRefUpdateSomeAndGet, fiberRefLocally, fiberRefLocallyWith, fiberRefUnsafeMake = (initial, options) => fiberRefUnsafeMakePatch(initial, {
  differ: update(),
  fork: options?.fork ?? identity,
  join: options?.join
}), fiberRefUnsafeMakeHashSet = (initial) => {
  const differ2 = hashSet();
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ2,
    fork: differ2.empty
  });
}, fiberRefUnsafeMakeReadonlyArray = (initial) => {
  const differ2 = readonlyArray(update());
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ2,
    fork: differ2.empty
  });
}, fiberRefUnsafeMakeContext = (initial) => {
  const differ2 = environment();
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ2,
    fork: differ2.empty
  });
}, fiberRefUnsafeMakePatch = (initial, options) => {
  const _fiberRef = {
    ...CommitPrototype,
    [FiberRefTypeId]: fiberRefVariance,
    initial,
    commit() {
      return fiberRefGet(this);
    },
    diff: (oldValue, newValue) => options.differ.diff(oldValue, newValue),
    combine: (first, second) => options.differ.combine(first, second),
    patch: (patch8) => (oldValue) => options.differ.patch(patch8, oldValue),
    fork: options.fork,
    join: options.join ?? ((_, n) => n)
  };
  return _fiberRef;
}, fiberRefUnsafeMakeRuntimeFlags = (initial) => fiberRefUnsafeMakePatch(initial, {
  differ,
  fork: differ.empty
}), currentContext, currentSchedulingPriority, currentMaxOpsBeforeYield, currentLogAnnotations, currentLogLevel, currentLogSpan, withSchedulingPriority, withMaxOpsBeforeYield, currentConcurrency, currentRequestBatching, currentUnhandledErrorLogLevel, withUnhandledErrorLogLevel, currentMetricLabels, metricLabels, currentForkScopeOverride, currentInterruptedCause, currentTracerEnabled, currentTracerTimingEnabled, currentTracerSpanAnnotations, currentTracerSpanLinks, ScopeTypeId, CloseableScopeTypeId, scopeAddFinalizer = (self, finalizer) => self.addFinalizer(() => asVoid(finalizer)), scopeAddFinalizerExit = (self, finalizer) => self.addFinalizer(finalizer), scopeClose = (self, exit2) => self.close(exit2), scopeFork = (self, strategy) => self.fork(strategy), YieldableError, makeException = (proto2, tag) => {

  class Base2 extends YieldableError {
    _tag = tag;
  }
  Object.assign(Base2.prototype, proto2);
  Base2.prototype.name = tag;
  return Base2;
}, RuntimeExceptionTypeId, RuntimeException, InterruptedExceptionTypeId, InterruptedException, isInterruptedException = (u) => hasProperty(u, InterruptedExceptionTypeId), IllegalArgumentExceptionTypeId, IllegalArgumentException, NoSuchElementExceptionTypeId, NoSuchElementException, isNoSuchElementException = (u) => hasProperty(u, NoSuchElementExceptionTypeId), InvalidPubSubCapacityExceptionTypeId, InvalidPubSubCapacityException, ExceededCapacityExceptionTypeId, ExceededCapacityException, TimeoutExceptionTypeId, TimeoutException, timeoutExceptionFromDuration = (duration) => new TimeoutException(`Operation timed out after '${format3(duration)}'`), UnknownExceptionTypeId, UnknownException, exitIsExit = (u) => isEffect(u) && ("_tag" in u) && (u._tag === "Success" || u._tag === "Failure"), exitIsFailure = (self) => self._tag === "Failure", exitIsSuccess = (self) => self._tag === "Success", exitAs, exitAsVoid = (self) => exitAs(self, undefined), exitCollectAll = (exits, options) => exitCollectAllInternal(exits, options?.parallel ? parallel : sequential), exitDie = (defect) => exitFailCause(die(defect)), exitFail = (error) => exitFailCause(fail(error)), exitFailCause = (cause) => {
  const effect = new EffectPrimitiveFailure(OP_FAILURE);
  effect.effect_instruction_i0 = cause;
  return effect;
}, exitFlatMap, exitFlatten = (self) => pipe(self, exitFlatMap(identity)), exitInterrupt = (fiberId2) => exitFailCause(interrupt(fiberId2)), exitMap, exitMatch, exitMatchEffect, exitSucceed = (value) => {
  const effect = new EffectPrimitiveSuccess(OP_SUCCESS);
  effect.effect_instruction_i0 = value;
  return effect;
}, exitVoid, exitZipWith, exitCollectAllInternal = (exits, combineCauses) => {
  const list = fromIterable2(exits);
  if (!isNonEmpty2(list)) {
    return none2();
  }
  return pipe(tailNonEmpty2(list), reduce(pipe(headNonEmpty2(list), exitMap(of2)), (accumulator, current) => pipe(accumulator, exitZipWith(current, {
    onSuccess: (list2, value) => pipe(list2, prepend2(value)),
    onFailure: combineCauses
  }))), exitMap(reverse2), exitMap((chunk) => toReadonlyArray(chunk)), some2);
}, deferredUnsafeMake = (fiberId2) => {
  const _deferred = {
    ...CommitPrototype,
    [DeferredTypeId]: deferredVariance,
    state: make12(pending([])),
    commit() {
      return deferredAwait(this);
    },
    blockingOn: fiberId2
  };
  return _deferred;
}, deferredMake = () => flatMap7(fiberId, (id) => deferredMakeAs(id)), deferredMakeAs = (fiberId2) => sync(() => deferredUnsafeMake(fiberId2)), deferredAwait = (self) => asyncInterrupt((resume) => {
  const state = get6(self.state);
  switch (state._tag) {
    case OP_STATE_DONE: {
      return resume(state.effect);
    }
    case OP_STATE_PENDING: {
      state.joiners.push(resume);
      return deferredInterruptJoiner(self, resume);
    }
  }
}, self.blockingOn), deferredComplete, deferredCompleteWith, deferredDone, deferredFailCause, deferredInterrupt = (self) => flatMap7(fiberId, (fiberId2) => deferredCompleteWith(self, interruptWith(fiberId2))), deferredSucceed, deferredUnsafeDone = (self, effect) => {
  const state = get6(self.state);
  if (state._tag === OP_STATE_PENDING) {
    set2(self.state, done(effect));
    for (let i = 0, len = state.joiners.length;i < len; i++) {
      state.joiners[i](effect);
    }
  }
}, deferredInterruptJoiner = (self, joiner) => sync(() => {
  const state = get6(self.state);
  if (state._tag === OP_STATE_PENDING) {
    const index = state.joiners.indexOf(joiner);
    if (index >= 0) {
      state.joiners.splice(index, 1);
    }
  }
}), constContext, context = () => constContext, contextWithEffect = (f) => flatMap7(context(), f), provideContext, provideSomeContext, mapInputContext, filterEffectOrElse, filterEffectOrFail, currentSpanFromFiber = (fiber) => {
  const span2 = fiber.currentSpan;
  return span2 !== undefined && span2._tag === "Span" ? some2(span2) : none2();
}, NoopSpanProto, noopSpan = (options) => Object.assign(Object.create(NoopSpanProto), options);
var init_core = __esm(() => {
  init_Array();
  init_Chunk();
  init_Context();
  init_Duration();
  init_Either();
  init_Equal();
  init_FiberId();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_HashMap();
  init_Inspectable();
  init_List();
  init_MutableRef();
  init_Option();
  init_Predicate();
  init_RuntimeFlagsPatch();
  init_Utils();
  init_blockedRequests();
  init_cause();
  init_deferred();
  init_differ();
  init_effectable();
  init_runtimeFlags();
  init_singleShotGen();
  EffectTypeId2 = /* @__PURE__ */ Symbol.for("effect/Effect");
  EffectPrimitive = class EffectPrimitive {
    _op;
    effect_instruction_i0 = undefined;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    trace = undefined;
    [EffectTypeId2] = effectVariance;
    constructor(_op) {
      this._op = _op;
    }
    [symbol2](that) {
      return this === that;
    }
    [symbol]() {
      return cached(this, random(this));
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toJSON() {
      return {
        _id: "Effect",
        _op: this._op,
        effect_instruction_i0: toJSON(this.effect_instruction_i0),
        effect_instruction_i1: toJSON(this.effect_instruction_i1),
        effect_instruction_i2: toJSON(this.effect_instruction_i2)
      };
    }
    toString() {
      return format(this.toJSON());
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
  };
  EffectPrimitiveFailure = class EffectPrimitiveFailure {
    _op;
    effect_instruction_i0 = undefined;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    trace = undefined;
    [EffectTypeId2] = effectVariance;
    constructor(_op) {
      this._op = _op;
      this._tag = _op;
    }
    [symbol2](that) {
      return exitIsExit(that) && that._op === "Failure" && equals(this.effect_instruction_i0, that.effect_instruction_i0);
    }
    [symbol]() {
      return pipe(string(this._tag), combine(hash(this.effect_instruction_i0)), cached(this));
    }
    get cause() {
      return this.effect_instruction_i0;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toJSON() {
      return {
        _id: "Exit",
        _tag: this._op,
        cause: this.cause.toJSON()
      };
    }
    toString() {
      return format(this.toJSON());
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
  };
  EffectPrimitiveSuccess = class EffectPrimitiveSuccess {
    _op;
    effect_instruction_i0 = undefined;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    trace = undefined;
    [EffectTypeId2] = effectVariance;
    constructor(_op) {
      this._op = _op;
      this._tag = _op;
    }
    [symbol2](that) {
      return exitIsExit(that) && that._op === "Success" && equals(this.effect_instruction_i0, that.effect_instruction_i0);
    }
    [symbol]() {
      return pipe(string(this._tag), combine(hash(this.effect_instruction_i0)), cached(this));
    }
    get value() {
      return this.effect_instruction_i0;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toJSON() {
      return {
        _id: "Exit",
        _tag: this._op,
        value: toJSON(this.value)
      };
    }
    toString() {
      return format(this.toJSON());
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
  };
  acquireUseRelease = /* @__PURE__ */ dual(3, (acquire, use, release) => uninterruptibleMask((restore) => flatMap7(acquire, (a) => flatMap7(exit(suspend(() => restore(use(a)))), (exit) => {
    return suspend(() => release(a, exit)).pipe(matchCauseEffect({
      onFailure: (cause) => {
        switch (exit._tag) {
          case OP_FAILURE:
            return failCause(sequential(exit.effect_instruction_i0, cause));
          case OP_SUCCESS:
            return failCause(cause);
        }
      },
      onSuccess: () => exit
    }));
  }))));
  as = /* @__PURE__ */ dual(2, (self, value) => flatMap7(self, () => succeed(value)));
  catchAllCause = /* @__PURE__ */ dual(2, (self, f) => {
    const effect = new EffectPrimitive(OP_ON_FAILURE);
    effect.effect_instruction_i0 = self;
    effect.effect_instruction_i1 = f;
    return effect;
  });
  catchAll = /* @__PURE__ */ dual(2, (self, f) => matchEffect(self, {
    onFailure: f,
    onSuccess: succeed
  }));
  catchIf = /* @__PURE__ */ dual(3, (self, predicate, f) => catchAllCause(self, (cause) => {
    const either2 = failureOrCause(cause);
    switch (either2._tag) {
      case "Left":
        return predicate(either2.left) ? f(either2.left) : failCause(cause);
      case "Right":
        return failCause(either2.right);
    }
  }));
  catchSome = /* @__PURE__ */ dual(2, (self, pf) => catchAllCause(self, (cause) => {
    const either2 = failureOrCause(cause);
    switch (either2._tag) {
      case "Left":
        return pipe(pf(either2.left), getOrElse(() => failCause(cause)));
      case "Right":
        return failCause(either2.right);
    }
  }));
  originalSymbol = /* @__PURE__ */ Symbol.for("effect/OriginalAnnotation");
  fiberId = /* @__PURE__ */ withFiberRuntime((state) => succeed(state.id()));
  flatMap7 = /* @__PURE__ */ dual(2, (self, f) => {
    const effect = new EffectPrimitive(OP_ON_SUCCESS);
    effect.effect_instruction_i0 = self;
    effect.effect_instruction_i1 = f;
    return effect;
  });
  andThen2 = /* @__PURE__ */ dual(2, (self, f) => flatMap7(self, (a) => {
    const b = typeof f === "function" ? f(a) : f;
    if (isEffect(b)) {
      return b;
    } else if (isPromiseLike(b)) {
      return unsafeAsync((resume) => {
        b.then((a2) => resume(succeed(a2)), (e) => resume(fail2(new UnknownException(e, "An unknown error occurred in Effect.andThen"))));
      });
    }
    return succeed(b);
  }));
  matchCause = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
    onFailure: (cause) => succeed(options.onFailure(cause)),
    onSuccess: (a) => succeed(options.onSuccess(a))
  }));
  matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => {
    const effect = new EffectPrimitive(OP_ON_SUCCESS_AND_FAILURE);
    effect.effect_instruction_i0 = self;
    effect.effect_instruction_i1 = options.onFailure;
    effect.effect_instruction_i2 = options.onSuccess;
    return effect;
  });
  matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const defects2 = defects(cause);
      if (defects2.length > 0) {
        return failCause(electFailures(cause));
      }
      const failures2 = failures(cause);
      if (failures2.length > 0) {
        return options.onFailure(unsafeHead2(failures2));
      }
      return failCause(cause);
    },
    onSuccess: options.onSuccess
  }));
  forEachSequential = /* @__PURE__ */ dual(2, (self, f) => suspend(() => {
    const arr = fromIterable(self);
    const ret2 = allocate(arr.length);
    let i = 0;
    return as(whileLoop({
      while: () => i < arr.length,
      body: () => f(arr[i], i),
      step: (b) => {
        ret2[i++] = b;
      }
    }), ret2);
  }));
  forEachSequentialDiscard = /* @__PURE__ */ dual(2, (self, f) => suspend(() => {
    const arr = fromIterable(self);
    let i = 0;
    return whileLoop({
      while: () => i < arr.length,
      body: () => f(arr[i], i),
      step: () => {
        i++;
      }
    });
  }));
  if_ = /* @__PURE__ */ dual((args) => typeof args[0] === "boolean" || isEffect(args[0]), (self, options) => isEffect(self) ? flatMap7(self, (b) => b ? options.onTrue() : options.onFalse()) : self ? options.onTrue() : options.onFalse());
  interrupt2 = /* @__PURE__ */ flatMap7(fiberId, (fiberId2) => interruptWith(fiberId2));
  intoDeferred = /* @__PURE__ */ dual(2, (self, deferred) => uninterruptibleMask((restore) => flatMap7(exit(restore(self)), (exit2) => deferredDone(deferred, exit2))));
  map9 = /* @__PURE__ */ dual(2, (self, f) => flatMap7(self, (a) => sync(() => f(a))));
  mapBoth = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
    onFailure: (e) => failSync(() => options.onFailure(e)),
    onSuccess: (a) => sync(() => options.onSuccess(a))
  }));
  mapError = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const either3 = failureOrCause(cause);
      switch (either3._tag) {
        case "Left": {
          return failSync(() => f(either3.left));
        }
        case "Right": {
          return failCause(either3.right);
        }
      }
    },
    onSuccess: succeed
  }));
  onError = /* @__PURE__ */ dual(2, (self, cleanup) => onExit(self, (exit2) => exitIsSuccess(exit2) ? void_ : cleanup(exit2.effect_instruction_i0)));
  onExit = /* @__PURE__ */ dual(2, (self, cleanup) => uninterruptibleMask((restore) => matchCauseEffect(restore(self), {
    onFailure: (cause1) => {
      const result = exitFailCause(cause1);
      return matchCauseEffect(cleanup(result), {
        onFailure: (cause2) => exitFailCause(sequential(cause1, cause2)),
        onSuccess: () => result
      });
    },
    onSuccess: (success) => {
      const result = exitSucceed(success);
      return zipRight(cleanup(result), result);
    }
  })));
  onInterrupt = /* @__PURE__ */ dual(2, (self, cleanup) => onExit(self, exitMatch({
    onFailure: (cause) => isInterruptedOnly(cause) ? asVoid(cleanup(interruptors(cause))) : void_,
    onSuccess: () => void_
  })));
  orElse2 = /* @__PURE__ */ dual(2, (self, that) => attemptOrElse(self, that, succeed));
  orDieWith = /* @__PURE__ */ dual(2, (self, f) => matchEffect(self, {
    onFailure: (e) => die2(f(e)),
    onSuccess: succeed
  }));
  partitionMap2 = partitionMap;
  runtimeFlags = /* @__PURE__ */ withFiberRuntime((_, status) => succeed(status.runtimeFlags));
  tap = /* @__PURE__ */ dual((args) => args.length === 3 || args.length === 2 && !(isObject(args[1]) && ("onlyEffect" in args[1])), (self, f) => flatMap7(self, (a) => {
    const b = typeof f === "function" ? f(a) : f;
    if (isEffect(b)) {
      return as(b, a);
    } else if (isPromiseLike(b)) {
      return unsafeAsync((resume) => {
        b.then((_) => resume(succeed(a)), (e) => resume(fail2(new UnknownException(e, "An unknown error occurred in Effect.tap"))));
      });
    }
    return succeed(a);
  }));
  attemptOrElse = /* @__PURE__ */ dual(3, (self, that, onSuccess) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const defects2 = defects(cause);
      if (defects2.length > 0) {
        return failCause(getOrThrow2(keepDefectsAndElectFailures(cause)));
      }
      return that();
    },
    onSuccess
  }));
  void_ = /* @__PURE__ */ succeed(undefined);
  whenEffect = /* @__PURE__ */ dual(2, (self, condition) => flatMap7(condition, (b) => {
    if (b) {
      return pipe(self, map9(some2));
    }
    return succeed(none2());
  }));
  withConcurrency = /* @__PURE__ */ dual(2, (self, concurrency) => fiberRefLocally(self, currentConcurrency, concurrency));
  withRequestBatching = /* @__PURE__ */ dual(2, (self, requestBatching) => fiberRefLocally(self, currentRequestBatching, requestBatching));
  withRuntimeFlags = /* @__PURE__ */ dual(2, (self, update2) => {
    const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
    effect.effect_instruction_i0 = update2;
    effect.effect_instruction_i1 = () => self;
    return effect;
  });
  withTracerEnabled = /* @__PURE__ */ dual(2, (effect, enabled2) => fiberRefLocally(effect, currentTracerEnabled, enabled2));
  withTracerTiming = /* @__PURE__ */ dual(2, (effect, enabled2) => fiberRefLocally(effect, currentTracerTimingEnabled, enabled2));
  zip2 = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, (a) => map9(that, (b) => [a, b])));
  zipLeft = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, (a) => as(that, a)));
  zipRight = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, () => that));
  zipWith2 = /* @__PURE__ */ dual(3, (self, that, f) => flatMap7(self, (a) => map9(that, (b) => f(a, b))));
  never = /* @__PURE__ */ asyncInterrupt(() => {
    const interval = setInterval(() => {}, 2 ** 31 - 1);
    return sync(() => clearInterval(interval));
  });
  interruptAsFiber = /* @__PURE__ */ dual(2, (self, fiberId2) => flatMap7(self.interruptAsFork(fiberId2), () => self.await));
  logLevelAll = {
    _tag: "All",
    syslog: 0,
    label: "ALL",
    ordinal: Number.MIN_SAFE_INTEGER,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelFatal = {
    _tag: "Fatal",
    syslog: 2,
    label: "FATAL",
    ordinal: 50000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelError = {
    _tag: "Error",
    syslog: 3,
    label: "ERROR",
    ordinal: 40000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelWarning = {
    _tag: "Warning",
    syslog: 4,
    label: "WARN",
    ordinal: 30000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelInfo = {
    _tag: "Info",
    syslog: 6,
    label: "INFO",
    ordinal: 20000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelDebug = {
    _tag: "Debug",
    syslog: 7,
    label: "DEBUG",
    ordinal: 1e4,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelTrace = {
    _tag: "Trace",
    syslog: 7,
    label: "TRACE",
    ordinal: 0,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelNone = {
    _tag: "None",
    syslog: 7,
    label: "OFF",
    ordinal: Number.MAX_SAFE_INTEGER,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  FiberRefTypeId = /* @__PURE__ */ Symbol.for(FiberRefSymbolKey);
  fiberRefVariance = {
    _A: (_) => _
  };
  fiberRefGetAndSet = /* @__PURE__ */ dual(2, (self, value) => fiberRefModify(self, (v) => [v, value]));
  fiberRefGetAndUpdate = /* @__PURE__ */ dual(2, (self, f) => fiberRefModify(self, (v) => [v, f(v)]));
  fiberRefGetAndUpdateSome = /* @__PURE__ */ dual(2, (self, pf) => fiberRefModify(self, (v) => [v, getOrElse(pf(v), () => v)]));
  fiberRefGetWith = /* @__PURE__ */ dual(2, (self, f) => flatMap7(fiberRefGet(self), f));
  fiberRefSet = /* @__PURE__ */ dual(2, (self, value) => fiberRefModify(self, () => [undefined, value]));
  fiberRefModify = /* @__PURE__ */ dual(2, (self, f) => withFiberRuntime((state) => {
    const [b, a] = f(state.getFiberRef(self));
    state.setFiberRef(self, a);
    return succeed(b);
  }));
  fiberRefUpdate = /* @__PURE__ */ dual(2, (self, f) => fiberRefModify(self, (v) => [undefined, f(v)]));
  fiberRefUpdateSome = /* @__PURE__ */ dual(2, (self, pf) => fiberRefModify(self, (v) => [undefined, getOrElse(pf(v), () => v)]));
  fiberRefUpdateAndGet = /* @__PURE__ */ dual(2, (self, f) => fiberRefModify(self, (v) => {
    const result = f(v);
    return [result, result];
  }));
  fiberRefUpdateSomeAndGet = /* @__PURE__ */ dual(2, (self, pf) => fiberRefModify(self, (v) => {
    const result = getOrElse(pf(v), () => v);
    return [result, result];
  }));
  fiberRefLocally = /* @__PURE__ */ dual(3, (use, self, value) => acquireUseRelease(zipLeft(fiberRefGet(self), fiberRefSet(self, value)), () => use, (oldValue) => fiberRefSet(self, oldValue)));
  fiberRefLocallyWith = /* @__PURE__ */ dual(3, (use, self, f) => fiberRefGetWith(self, (a) => fiberRefLocally(use, self, f(a))));
  currentContext = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentContext"), () => fiberRefUnsafeMakeContext(empty4()));
  currentSchedulingPriority = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => fiberRefUnsafeMake(0));
  currentMaxOpsBeforeYield = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => fiberRefUnsafeMake(2048));
  currentLogAnnotations = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => fiberRefUnsafeMake(empty9()));
  currentLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogLevel"), () => fiberRefUnsafeMake(logLevelInfo));
  currentLogSpan = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogSpan"), () => fiberRefUnsafeMake(empty10()));
  withSchedulingPriority = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentSchedulingPriority, scheduler));
  withMaxOpsBeforeYield = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentMaxOpsBeforeYield, scheduler));
  currentConcurrency = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentConcurrency"), () => fiberRefUnsafeMake("unbounded"));
  currentRequestBatching = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentRequestBatching"), () => fiberRefUnsafeMake(true));
  currentUnhandledErrorLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => fiberRefUnsafeMake(some2(logLevelDebug)));
  withUnhandledErrorLogLevel = /* @__PURE__ */ dual(2, (self, level) => fiberRefLocally(self, currentUnhandledErrorLogLevel, level));
  currentMetricLabels = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentMetricLabels"), () => fiberRefUnsafeMakeReadonlyArray(empty2()));
  metricLabels = /* @__PURE__ */ fiberRefGet(currentMetricLabels);
  currentForkScopeOverride = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => fiberRefUnsafeMake(none2(), {
    fork: () => none2(),
    join: (parent, _) => parent
  }));
  currentInterruptedCause = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => fiberRefUnsafeMake(empty20, {
    fork: () => empty20,
    join: (parent, _) => parent
  }));
  currentTracerEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerEnabled"), () => fiberRefUnsafeMake(true));
  currentTracerTimingEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerTiming"), () => fiberRefUnsafeMake(true));
  currentTracerSpanAnnotations = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerSpanAnnotations"), () => fiberRefUnsafeMake(empty9()));
  currentTracerSpanLinks = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerSpanLinks"), () => fiberRefUnsafeMake(empty5()));
  ScopeTypeId = /* @__PURE__ */ Symbol.for("effect/Scope");
  CloseableScopeTypeId = /* @__PURE__ */ Symbol.for("effect/CloseableScope");
  YieldableError = /* @__PURE__ */ function() {

    class YieldableError2 extends globalThis.Error {
      commit() {
        return fail2(this);
      }
      toJSON() {
        const obj = {
          ...this
        };
        if (this.message)
          obj.message = this.message;
        if (this.cause)
          obj.cause = this.cause;
        return obj;
      }
      [NodeInspectSymbol]() {
        if (this.toString !== globalThis.Error.prototype.toString) {
          return this.stack ? `${this.toString()}
${this.stack.split(`
`).slice(1).join(`
`)}` : this.toString();
        } else if ("Bun" in globalThis) {
          return pretty(fail(this), {
            renderErrorCause: true
          });
        }
        return this;
      }
    }
    Object.assign(YieldableError2.prototype, StructuralCommitPrototype);
    return YieldableError2;
  }();
  RuntimeExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/RuntimeException");
  RuntimeException = /* @__PURE__ */ makeException({
    [RuntimeExceptionTypeId]: RuntimeExceptionTypeId
  }, "RuntimeException");
  InterruptedExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/InterruptedException");
  InterruptedException = /* @__PURE__ */ makeException({
    [InterruptedExceptionTypeId]: InterruptedExceptionTypeId
  }, "InterruptedException");
  IllegalArgumentExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/IllegalArgument");
  IllegalArgumentException = /* @__PURE__ */ makeException({
    [IllegalArgumentExceptionTypeId]: IllegalArgumentExceptionTypeId
  }, "IllegalArgumentException");
  NoSuchElementExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/NoSuchElement");
  NoSuchElementException = /* @__PURE__ */ makeException({
    [NoSuchElementExceptionTypeId]: NoSuchElementExceptionTypeId
  }, "NoSuchElementException");
  InvalidPubSubCapacityExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/InvalidPubSubCapacityException");
  InvalidPubSubCapacityException = /* @__PURE__ */ makeException({
    [InvalidPubSubCapacityExceptionTypeId]: InvalidPubSubCapacityExceptionTypeId
  }, "InvalidPubSubCapacityException");
  ExceededCapacityExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/ExceededCapacityException");
  ExceededCapacityException = /* @__PURE__ */ makeException({
    [ExceededCapacityExceptionTypeId]: ExceededCapacityExceptionTypeId
  }, "ExceededCapacityException");
  TimeoutExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/Timeout");
  TimeoutException = /* @__PURE__ */ makeException({
    [TimeoutExceptionTypeId]: TimeoutExceptionTypeId
  }, "TimeoutException");
  UnknownExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/UnknownException");
  UnknownException = /* @__PURE__ */ function() {

    class UnknownException2 extends YieldableError {
      _tag = "UnknownException";
      error;
      constructor(cause, message) {
        super(message ?? "An unknown error occurred", {
          cause
        });
        this.error = cause;
      }
    }
    Object.assign(UnknownException2.prototype, {
      [UnknownExceptionTypeId]: UnknownExceptionTypeId,
      name: "UnknownException"
    });
    return UnknownException2;
  }();
  exitAs = /* @__PURE__ */ dual(2, (self, value) => {
    switch (self._tag) {
      case OP_FAILURE: {
        return exitFailCause(self.effect_instruction_i0);
      }
      case OP_SUCCESS: {
        return exitSucceed(value);
      }
    }
  });
  exitFlatMap = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE: {
        return exitFailCause(self.effect_instruction_i0);
      }
      case OP_SUCCESS: {
        return f(self.effect_instruction_i0);
      }
    }
  });
  exitMap = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE:
        return exitFailCause(self.effect_instruction_i0);
      case OP_SUCCESS:
        return exitSucceed(f(self.effect_instruction_i0));
    }
  });
  exitMatch = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE:
        return onFailure(self.effect_instruction_i0);
      case OP_SUCCESS:
        return onSuccess(self.effect_instruction_i0);
    }
  });
  exitMatchEffect = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE:
        return onFailure(self.effect_instruction_i0);
      case OP_SUCCESS:
        return onSuccess(self.effect_instruction_i0);
    }
  });
  exitVoid = /* @__PURE__ */ exitSucceed(undefined);
  exitZipWith = /* @__PURE__ */ dual(3, (self, that, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE: {
        switch (that._tag) {
          case OP_SUCCESS:
            return exitFailCause(self.effect_instruction_i0);
          case OP_FAILURE: {
            return exitFailCause(onFailure(self.effect_instruction_i0, that.effect_instruction_i0));
          }
        }
      }
      case OP_SUCCESS: {
        switch (that._tag) {
          case OP_SUCCESS:
            return exitSucceed(onSuccess(self.effect_instruction_i0, that.effect_instruction_i0));
          case OP_FAILURE:
            return exitFailCause(that.effect_instruction_i0);
        }
      }
    }
  });
  deferredComplete = /* @__PURE__ */ dual(2, (self, effect) => intoDeferred(effect, self));
  deferredCompleteWith = /* @__PURE__ */ dual(2, (self, effect) => sync(() => {
    const state = get6(self.state);
    switch (state._tag) {
      case OP_STATE_DONE: {
        return false;
      }
      case OP_STATE_PENDING: {
        set2(self.state, done(effect));
        for (let i = 0, len = state.joiners.length;i < len; i++) {
          state.joiners[i](effect);
        }
        return true;
      }
    }
  }));
  deferredDone = /* @__PURE__ */ dual(2, (self, exit2) => deferredCompleteWith(self, exit2));
  deferredFailCause = /* @__PURE__ */ dual(2, (self, cause) => deferredCompleteWith(self, failCause(cause)));
  deferredSucceed = /* @__PURE__ */ dual(2, (self, value) => deferredCompleteWith(self, succeed(value)));
  constContext = /* @__PURE__ */ withFiberRuntime((fiber) => exitSucceed(fiber.currentContext));
  provideContext = /* @__PURE__ */ dual(2, (self, context2) => fiberRefLocally(currentContext, context2)(self));
  provideSomeContext = /* @__PURE__ */ dual(2, (self, context2) => fiberRefLocallyWith(currentContext, (parent) => merge3(parent, context2))(self));
  mapInputContext = /* @__PURE__ */ dual(2, (self, f) => contextWithEffect((context2) => provideContext(self, f(context2))));
  filterEffectOrElse = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => flatMap7(options.predicate(a), (pass) => pass ? succeed(a) : options.orElse(a))));
  filterEffectOrFail = /* @__PURE__ */ dual(2, (self, options) => filterEffectOrElse(self, {
    predicate: options.predicate,
    orElse: (a) => fail2(options.orFailWith(a))
  }));
  NoopSpanProto = {
    _tag: "Span",
    spanId: "noop",
    traceId: "noop",
    sampled: false,
    status: {
      _tag: "Ended",
      startTime: /* @__PURE__ */ BigInt(0),
      endTime: /* @__PURE__ */ BigInt(0),
      exit: exitVoid
    },
    attributes: /* @__PURE__ */ new Map,
    links: [],
    kind: "internal",
    attribute() {},
    event() {},
    end() {},
    addLinks() {}
  };
});

// node_modules/effect/dist/esm/Deferred.js
var _await, done2, interrupt3, unsafeMake4;
var init_Deferred = __esm(() => {
  init_core();
  init_deferred();
  _await = deferredAwait;
  done2 = deferredDone;
  interrupt3 = deferredInterrupt;
  unsafeMake4 = deferredUnsafeMake;
});

// node_modules/effect/dist/esm/Exit.js
var isSuccess, die3, fail3, failCause2, flatten6, interrupt4, succeed2;
var init_Exit = __esm(() => {
  init_core();
  isSuccess = exitIsSuccess;
  die3 = exitDie;
  fail3 = exitFail;
  failCause2 = exitFailCause;
  flatten6 = exitFlatten;
  interrupt4 = exitInterrupt;
  succeed2 = exitSucceed;
});

// node_modules/effect/dist/esm/MutableHashMap.js
class BucketIterator {
  backing;
  constructor(backing) {
    this.backing = backing;
  }
  currentBucket;
  next() {
    if (this.currentBucket === undefined) {
      const result2 = this.backing.next();
      if (result2.done) {
        return result2;
      }
      this.currentBucket = result2.value[Symbol.iterator]();
    }
    const result = this.currentBucket.next();
    if (result.done) {
      this.currentBucket = undefined;
      return this.next();
    }
    return result;
  }
}
var TypeId9, MutableHashMapProto, MutableHashMapIterator, empty21 = () => {
  const self = Object.create(MutableHashMapProto);
  self.referential = new Map;
  self.buckets = new Map;
  self.bucketsSize = 0;
  return self;
}, get8, getFromBucket = (self, bucket, key, remove6 = false) => {
  for (let i = 0, len = bucket.length;i < len; i++) {
    if (key[symbol2](bucket[i][0])) {
      const value = bucket[i][1];
      if (remove6) {
        bucket.splice(i, 1);
        self.bucketsSize--;
      }
      return some2(value);
    }
  }
  return none2();
}, has4, set4, removeFromBucket = (self, bucket, key) => {
  for (let i = 0, len = bucket.length;i < len; i++) {
    if (key[symbol2](bucket[i][0])) {
      bucket.splice(i, 1);
      self.bucketsSize--;
      return;
    }
  }
}, remove6, size4 = (self) => {
  return self.referential.size + self.bucketsSize;
};
var init_MutableHashMap = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  TypeId9 = /* @__PURE__ */ Symbol.for("effect/MutableHashMap");
  MutableHashMapProto = {
    [TypeId9]: TypeId9,
    [Symbol.iterator]() {
      return new MutableHashMapIterator(this);
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableHashMap",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  MutableHashMapIterator = class MutableHashMapIterator {
    self;
    referentialIterator;
    bucketIterator;
    constructor(self) {
      this.self = self;
      this.referentialIterator = self.referential[Symbol.iterator]();
    }
    next() {
      if (this.bucketIterator !== undefined) {
        return this.bucketIterator.next();
      }
      const result = this.referentialIterator.next();
      if (result.done) {
        this.bucketIterator = new BucketIterator(this.self.buckets.values());
        return this.next();
      }
      return result;
    }
    [Symbol.iterator]() {
      return new MutableHashMapIterator(this.self);
    }
  };
  get8 = /* @__PURE__ */ dual(2, (self, key) => {
    if (isEqual(key) === false) {
      return self.referential.has(key) ? some2(self.referential.get(key)) : none2();
    }
    const hash2 = key[symbol]();
    const bucket = self.buckets.get(hash2);
    if (bucket === undefined) {
      return none2();
    }
    return getFromBucket(self, bucket, key);
  });
  has4 = /* @__PURE__ */ dual(2, (self, key) => isSome2(get8(self, key)));
  set4 = /* @__PURE__ */ dual(3, (self, key, value) => {
    if (isEqual(key) === false) {
      self.referential.set(key, value);
      return self;
    }
    const hash2 = key[symbol]();
    const bucket = self.buckets.get(hash2);
    if (bucket === undefined) {
      self.buckets.set(hash2, [[key, value]]);
      self.bucketsSize++;
      return self;
    }
    removeFromBucket(self, bucket, key);
    bucket.push([key, value]);
    self.bucketsSize++;
    return self;
  });
  remove6 = /* @__PURE__ */ dual(2, (self, key) => {
    if (isEqual(key) === false) {
      self.referential.delete(key);
      return self;
    }
    const hash2 = key[symbol]();
    const bucket = self.buckets.get(hash2);
    if (bucket === undefined) {
      return self;
    }
    removeFromBucket(self, bucket, key);
    if (bucket.length === 0) {
      self.buckets.delete(hash2);
    }
    return self;
  });
});

// node_modules/effect/dist/esm/MutableList.js
var TypeId10, MutableListProto, makeNode = (value) => ({
  value,
  removed: false,
  prev: undefined,
  next: undefined
}), empty22 = () => {
  const list = Object.create(MutableListProto);
  list.head = undefined;
  list.tail = undefined;
  list._length = 0;
  return list;
}, isEmpty6 = (self) => length(self) === 0, length = (self) => self._length, append3, shift = (self) => {
  const head3 = self.head;
  if (head3 !== undefined) {
    remove7(self, head3);
    return head3.value;
  }
  return;
}, remove7 = (self, node) => {
  if (node.removed) {
    return;
  }
  node.removed = true;
  if (node.prev !== undefined && node.next !== undefined) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  } else if (node.prev !== undefined) {
    self.tail = node.prev;
    node.prev.next = undefined;
  } else if (node.next !== undefined) {
    self.head = node.next;
    node.next.prev = undefined;
  } else {
    self.tail = undefined;
    self.head = undefined;
  }
  if (self._length > 0) {
    self._length -= 1;
  }
};
var init_MutableList = __esm(() => {
  init_Function();
  init_Inspectable();
  TypeId10 = /* @__PURE__ */ Symbol.for("effect/MutableList");
  MutableListProto = {
    [TypeId10]: TypeId10,
    [Symbol.iterator]() {
      let done3 = false;
      let head3 = this.head;
      return {
        next() {
          if (done3) {
            return this.return();
          }
          if (head3 == null) {
            done3 = true;
            return this.return();
          }
          const value = head3.value;
          head3 = head3.next;
          return {
            done: done3,
            value
          };
        },
        return(value) {
          if (!done3) {
            done3 = true;
          }
          return {
            done: true,
            value
          };
        }
      };
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableList",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  append3 = /* @__PURE__ */ dual(2, (self, value) => {
    const node = makeNode(value);
    if (self.head === undefined) {
      self.head = node;
    }
    if (self.tail === undefined) {
      self.tail = node;
    } else {
      self.tail.next = node;
      node.prev = self.tail;
      self.tail = node;
    }
    self._length += 1;
    return self;
  });
});

// node_modules/effect/dist/esm/MutableQueue.js
var TypeId11, EmptyMutableQueue, MutableQueueProto, make19 = (capacity) => {
  const queue = Object.create(MutableQueueProto);
  queue.queue = empty22();
  queue.capacity = capacity;
  return queue;
}, unbounded = () => make19(undefined), offer, poll;
var init_MutableQueue = __esm(() => {
  init_Chunk();
  init_Function();
  init_Inspectable();
  init_MutableList();
  TypeId11 = /* @__PURE__ */ Symbol.for("effect/MutableQueue");
  EmptyMutableQueue = /* @__PURE__ */ Symbol.for("effect/mutable/MutableQueue/Empty");
  MutableQueueProto = {
    [TypeId11]: TypeId11,
    [Symbol.iterator]() {
      return Array.from(this.queue)[Symbol.iterator]();
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableQueue",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  offer = /* @__PURE__ */ dual(2, (self, value) => {
    const queueLength = length(self.queue);
    if (self.capacity !== undefined && queueLength === self.capacity) {
      return false;
    }
    append3(value)(self.queue);
    return true;
  });
  poll = /* @__PURE__ */ dual(2, (self, def) => {
    if (isEmpty6(self.queue)) {
      return def;
    }
    return shift(self.queue);
  });
});

// node_modules/effect/dist/esm/internal/clock.js
var ClockSymbolKey = "effect/Clock", ClockTypeId, clockTag, MAX_TIMER_MILLIS, globalClockScheduler, performanceNowNanos, processOrPerformanceNow, ClockImpl, make20 = () => new ClockImpl;
var init_clock = __esm(() => {
  init_Context();
  init_Duration();
  init_Function();
  init_core();
  ClockTypeId = /* @__PURE__ */ Symbol.for(ClockSymbolKey);
  clockTag = /* @__PURE__ */ GenericTag("effect/Clock");
  MAX_TIMER_MILLIS = 2 ** 31 - 1;
  globalClockScheduler = {
    unsafeSchedule(task, duration) {
      const millis2 = toMillis(duration);
      if (millis2 > MAX_TIMER_MILLIS) {
        return constFalse;
      }
      let completed = false;
      const handle = setTimeout(() => {
        completed = true;
        task();
      }, millis2);
      return () => {
        clearTimeout(handle);
        return !completed;
      };
    }
  };
  performanceNowNanos = /* @__PURE__ */ function() {
    const bigint1e62 = /* @__PURE__ */ BigInt(1e6);
    if (typeof performance === "undefined") {
      return () => BigInt(Date.now()) * bigint1e62;
    } else if (typeof performance.timeOrigin === "number" && performance.timeOrigin === 0) {
      return () => BigInt(Math.round(performance.now() * 1e6));
    }
    const origin = /* @__PURE__ */ BigInt(/* @__PURE__ */ Date.now()) * bigint1e62 - /* @__PURE__ */ BigInt(/* @__PURE__ */ Math.round(/* @__PURE__ */ performance.now() * 1e6));
    return () => origin + BigInt(Math.round(performance.now() * 1e6));
  }();
  processOrPerformanceNow = /* @__PURE__ */ function() {
    const processHrtime = typeof process === "object" && "hrtime" in process && typeof process.hrtime.bigint === "function" ? process.hrtime : undefined;
    if (!processHrtime) {
      return performanceNowNanos;
    }
    const origin = /* @__PURE__ */ performanceNowNanos() - /* @__PURE__ */ processHrtime.bigint();
    return () => origin + processHrtime.bigint();
  }();
  ClockImpl = class ClockImpl {
    [ClockTypeId] = ClockTypeId;
    unsafeCurrentTimeMillis() {
      return Date.now();
    }
    unsafeCurrentTimeNanos() {
      return processOrPerformanceNow();
    }
    currentTimeMillis = /* @__PURE__ */ sync(() => this.unsafeCurrentTimeMillis());
    currentTimeNanos = /* @__PURE__ */ sync(() => this.unsafeCurrentTimeNanos());
    scheduler() {
      return succeed(globalClockScheduler);
    }
    sleep(duration) {
      return async_((resume) => {
        const canceler = globalClockScheduler.unsafeSchedule(() => resume(void_), duration);
        return asVoid(sync(canceler));
      });
    }
  };
});

// node_modules/effect/dist/esm/internal/opCodes/configError.js
var OP_AND = "And", OP_OR = "Or", OP_INVALID_DATA = "InvalidData", OP_MISSING_DATA = "MissingData", OP_SOURCE_UNAVAILABLE = "SourceUnavailable", OP_UNSUPPORTED = "Unsupported";

// node_modules/effect/dist/esm/internal/configError.js
var ConfigErrorSymbolKey = "effect/ConfigError", ConfigErrorTypeId, proto2, And = (self, that) => {
  const error = Object.create(proto2);
  error._op = OP_AND;
  error.left = self;
  error.right = that;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      return `${this.left} and ${this.right}`;
    }
  });
  return error;
}, Or = (self, that) => {
  const error = Object.create(proto2);
  error._op = OP_OR;
  error.left = self;
  error.right = that;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      return `${this.left} or ${this.right}`;
    }
  });
  return error;
}, InvalidData = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_INVALID_DATA;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Invalid data at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, MissingData = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_MISSING_DATA;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Missing data at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, SourceUnavailable = (path, message, cause, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_SOURCE_UNAVAILABLE;
  error.path = path;
  error.message = message;
  error.cause = cause;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Source unavailable at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, Unsupported = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_UNSUPPORTED;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Unsupported operation at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, prefixed;
var init_configError = __esm(() => {
  init_Array();
  init_Either();
  init_Function();
  init_Predicate();
  ConfigErrorTypeId = /* @__PURE__ */ Symbol.for(ConfigErrorSymbolKey);
  proto2 = {
    _tag: "ConfigError",
    [ConfigErrorTypeId]: ConfigErrorTypeId
  };
  prefixed = /* @__PURE__ */ dual(2, (self, prefix) => {
    switch (self._op) {
      case OP_AND: {
        return And(prefixed(self.left, prefix), prefixed(self.right, prefix));
      }
      case OP_OR: {
        return Or(prefixed(self.left, prefix), prefixed(self.right, prefix));
      }
      case OP_INVALID_DATA: {
        return InvalidData([...prefix, ...self.path], self.message);
      }
      case OP_MISSING_DATA: {
        return MissingData([...prefix, ...self.path], self.message);
      }
      case OP_SOURCE_UNAVAILABLE: {
        return SourceUnavailable([...prefix, ...self.path], self.message, self.cause);
      }
      case OP_UNSUPPORTED: {
        return Unsupported([...prefix, ...self.path], self.message);
      }
    }
  });
});

// node_modules/effect/dist/esm/internal/configProvider/pathPatch.js
var empty23, patch8;
var init_pathPatch = __esm(() => {
  init_Array();
  init_Either();
  init_Function();
  init_List();
  init_Option();
  init_configError();
  empty23 = {
    _tag: "Empty"
  };
  patch8 = /* @__PURE__ */ dual(2, (path, patch9) => {
    let input = of3(patch9);
    let output = path;
    while (isCons(input)) {
      const patch10 = input.head;
      switch (patch10._tag) {
        case "Empty": {
          input = input.tail;
          break;
        }
        case "AndThen": {
          input = cons(patch10.first, cons(patch10.second, input.tail));
          break;
        }
        case "MapName": {
          output = map3(output, patch10.f);
          input = input.tail;
          break;
        }
        case "Nested": {
          output = prepend(output, patch10.name);
          input = input.tail;
          break;
        }
        case "Unnested": {
          const containsName = pipe(head(output), contains(patch10.name));
          if (containsName) {
            output = tailNonEmpty(output);
            input = input.tail;
          } else {
            return left2(MissingData(output, `Expected ${patch10.name} to be in path in ConfigProvider#unnested`));
          }
          break;
        }
      }
    }
    return right2(output);
  });
});

// node_modules/effect/dist/esm/internal/opCodes/config.js
var OP_CONSTANT = "Constant", OP_FAIL2 = "Fail", OP_FALLBACK = "Fallback", OP_DESCRIBED = "Described", OP_LAZY = "Lazy", OP_MAP_OR_FAIL = "MapOrFail", OP_NESTED = "Nested", OP_PRIMITIVE = "Primitive", OP_SEQUENCE = "Sequence", OP_HASHMAP = "HashMap", OP_ZIP_WITH = "ZipWith";

// node_modules/effect/dist/esm/internal/string-utils.js
var init_string_utils = () => {};

// node_modules/effect/dist/esm/internal/configProvider.js
var concat = (l, r) => [...l, ...r], ConfigProviderSymbolKey = "effect/ConfigProvider", ConfigProviderTypeId, configProviderTag, FlatConfigProviderSymbolKey = "effect/ConfigProviderFlat", FlatConfigProviderTypeId, make22 = (options) => ({
  [ConfigProviderTypeId]: ConfigProviderTypeId,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...options
}), makeFlat = (options) => ({
  [FlatConfigProviderTypeId]: FlatConfigProviderTypeId,
  patch: options.patch,
  load: (path, config, split = true) => options.load(path, config, split),
  enumerateChildren: options.enumerateChildren
}), fromFlat = (flat) => make22({
  load: (config) => flatMap7(fromFlatLoop(flat, empty2(), config, false), (chunk) => match2(head(chunk), {
    onNone: () => fail2(MissingData(empty2(), `Expected a single value having structure: ${config}`)),
    onSome: succeed
  })),
  flattened: flat
}), fromEnv = (options) => {
  const {
    pathDelim,
    seqDelim
  } = Object.assign({}, {
    pathDelim: "_",
    seqDelim: ","
  }, options);
  const makePathString = (path) => pipe(path, join(pathDelim));
  const unmakePathString = (pathString) => pathString.split(pathDelim);
  const getEnv = () => typeof process !== "undefined" && ("env" in process) && typeof process.env === "object" ? process.env : {};
  const load = (path, primitive, split = true) => {
    const pathString = makePathString(path);
    const current = getEnv();
    const valueOpt = pathString in current ? some2(current[pathString]) : none2();
    return pipe(valueOpt, mapError(() => MissingData(path, `Expected ${pathString} to exist in the process context`)), flatMap7((value) => parsePrimitive(value, path, primitive, seqDelim, split)));
  };
  const enumerateChildren = (path) => sync(() => {
    const current = getEnv();
    const keys3 = Object.keys(current);
    const keyPaths = keys3.map((value) => unmakePathString(value.toUpperCase()));
    const filteredKeyPaths = keyPaths.filter((keyPath) => {
      for (let i = 0;i < path.length; i++) {
        const pathComponent = pipe(path, unsafeGet(i));
        const currentElement = keyPath[i];
        if (currentElement === undefined || pathComponent !== currentElement) {
          return false;
        }
      }
      return true;
    }).flatMap((keyPath) => keyPath.slice(path.length, path.length + 1));
    return fromIterable5(filteredKeyPaths);
  });
  return fromFlat(makeFlat({
    load,
    enumerateChildren,
    patch: empty23
  }));
}, extend = (leftDef, rightDef, left3, right3) => {
  const leftPad = unfold(left3.length, (index) => index >= right3.length ? none2() : some2([leftDef(index), index + 1]));
  const rightPad = unfold(right3.length, (index) => index >= left3.length ? none2() : some2([rightDef(index), index + 1]));
  const leftExtension = concat(left3, leftPad);
  const rightExtension = concat(right3, rightPad);
  return [leftExtension, rightExtension];
}, appendConfigPath = (path, config) => {
  let op = config;
  if (op._tag === "Nested") {
    const out = path.slice();
    while (op._tag === "Nested") {
      out.push(op.name);
      op = op.config;
    }
    return out;
  }
  return path;
}, fromFlatLoop = (flat, prefix, config, split) => {
  const op = config;
  switch (op._tag) {
    case OP_CONSTANT: {
      return succeed(of(op.value));
    }
    case OP_DESCRIBED: {
      return suspend(() => fromFlatLoop(flat, prefix, op.config, split));
    }
    case OP_FAIL2: {
      return fail2(MissingData(prefix, op.message));
    }
    case OP_FALLBACK: {
      return pipe(suspend(() => fromFlatLoop(flat, prefix, op.first, split)), catchAll((error1) => {
        if (op.condition(error1)) {
          return pipe(fromFlatLoop(flat, prefix, op.second, split), catchAll((error2) => fail2(Or(error1, error2))));
        }
        return fail2(error1);
      }));
    }
    case OP_LAZY: {
      return suspend(() => fromFlatLoop(flat, prefix, op.config(), split));
    }
    case OP_MAP_OR_FAIL: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.original, split), flatMap7(forEachSequential((a) => pipe(op.mapOrFail(a), mapError(prefixed(appendConfigPath(prefix, op.original))))))));
    }
    case OP_NESTED: {
      return suspend(() => fromFlatLoop(flat, concat(prefix, of(op.name)), op.config, split));
    }
    case OP_PRIMITIVE: {
      return pipe(patch8(prefix, flat.patch), flatMap7((prefix2) => pipe(flat.load(prefix2, op, split), flatMap7((values3) => {
        if (values3.length === 0) {
          const name = pipe(last(prefix2), getOrElse(() => "<n/a>"));
          return fail2(MissingData([], `Expected ${op.description} with name ${name}`));
        }
        return succeed(values3);
      }))));
    }
    case OP_SEQUENCE: {
      return pipe(patch8(prefix, flat.patch), flatMap7((patchedPrefix) => pipe(flat.enumerateChildren(patchedPrefix), flatMap7(indicesFrom), flatMap7((indices) => {
        if (indices.length === 0) {
          return suspend(() => map9(fromFlatLoop(flat, prefix, op.config, true), of));
        }
        return pipe(forEachSequential(indices, (index) => fromFlatLoop(flat, append(prefix, `[${index}]`), op.config, true)), map9((chunkChunk) => {
          const flattened = flatten(chunkChunk);
          if (flattened.length === 0) {
            return of(empty2());
          }
          return of(flattened);
        }));
      }))));
    }
    case OP_HASHMAP: {
      return suspend(() => pipe(patch8(prefix, flat.patch), flatMap7((prefix2) => pipe(flat.enumerateChildren(prefix2), flatMap7((keys3) => {
        return pipe(keys3, forEachSequential((key) => fromFlatLoop(flat, concat(prefix2, of(key)), op.valueConfig, split)), map9((matrix) => {
          if (matrix.length === 0) {
            return of(empty9());
          }
          return pipe(transpose(matrix), map3((values3) => fromIterable6(zip(fromIterable(keys3), values3))));
        }));
      })))));
    }
    case OP_ZIP_WITH: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.left, split), either2, flatMap7((left3) => pipe(fromFlatLoop(flat, prefix, op.right, split), either2, flatMap7((right3) => {
        if (isLeft2(left3) && isLeft2(right3)) {
          return fail2(And(left3.left, right3.left));
        }
        if (isLeft2(left3) && isRight2(right3)) {
          return fail2(left3.left);
        }
        if (isRight2(left3) && isLeft2(right3)) {
          return fail2(right3.left);
        }
        if (isRight2(left3) && isRight2(right3)) {
          const path = pipe(prefix, join("."));
          const fail4 = fromFlatLoopFail(prefix, path);
          const [lefts, rights] = extend(fail4, fail4, pipe(left3.right, map3(right2)), pipe(right3.right, map3(right2)));
          return pipe(lefts, zip(rights), forEachSequential(([left4, right4]) => pipe(zip2(left4, right4), map9(([left5, right5]) => op.zip(left5, right5)))));
        }
        throw new Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
      })))));
    }
  }
}, fromFlatLoopFail = (prefix, path) => (index) => left2(MissingData(prefix, `The element at index ${index} in a sequence at path "${path}" was missing`)), splitPathString = (text, delim) => {
  const split = text.split(new RegExp(`\\s*${escape(delim)}\\s*`));
  return split;
}, parsePrimitive = (text, path, primitive, delimiter, split) => {
  if (!split) {
    return pipe(primitive.parse(text), mapBoth({
      onFailure: prefixed(path),
      onSuccess: of
    }));
  }
  return pipe(splitPathString(text, delimiter), forEachSequential((char) => primitive.parse(char.trim())), mapError(prefixed(path)));
}, transpose = (array4) => {
  return Object.keys(array4[0]).map((column) => array4.map((row) => row[column]));
}, indicesFrom = (quotedIndices) => pipe(forEachSequential(quotedIndices, parseQuotedIndex), mapBoth({
  onFailure: () => empty2(),
  onSuccess: sort(Order)
}), either2, map9(merge)), QUOTED_INDEX_REGEX, parseQuotedIndex = (str) => {
  const match6 = str.match(QUOTED_INDEX_REGEX);
  if (match6 !== null) {
    const matchedIndex = match6[2];
    return pipe(matchedIndex !== undefined && matchedIndex.length > 0 ? some2(matchedIndex) : none2(), flatMap(parseInteger));
  }
  return none2();
}, parseInteger = (str) => {
  const parsedIndex = Number.parseInt(str);
  return Number.isNaN(parsedIndex) ? none2() : some2(parsedIndex);
};
var init_configProvider = __esm(() => {
  init_Array();
  init_Context();
  init_Either();
  init_Function();
  init_HashMap();
  init_HashSet();
  init_Number();
  init_Option();
  init_Predicate();
  init_RegExp();
  init_configError();
  init_pathPatch();
  init_core();
  init_string_utils();
  ConfigProviderTypeId = /* @__PURE__ */ Symbol.for(ConfigProviderSymbolKey);
  configProviderTag = /* @__PURE__ */ GenericTag("effect/ConfigProvider");
  FlatConfigProviderTypeId = /* @__PURE__ */ Symbol.for(FlatConfigProviderSymbolKey);
  QUOTED_INDEX_REGEX = /^(\[(\d+)\])$/;
});

// node_modules/effect/dist/esm/internal/defaultServices/console.js
var TypeId12, consoleTag, defaultConsole;
var init_console = __esm(() => {
  init_Context();
  init_core();
  TypeId12 = /* @__PURE__ */ Symbol.for("effect/Console");
  consoleTag = /* @__PURE__ */ GenericTag("effect/Console");
  defaultConsole = {
    [TypeId12]: TypeId12,
    assert(condition, ...args) {
      return sync(() => {
        console.assert(condition, ...args);
      });
    },
    clear: /* @__PURE__ */ sync(() => {
      console.clear();
    }),
    count(label) {
      return sync(() => {
        console.count(label);
      });
    },
    countReset(label) {
      return sync(() => {
        console.countReset(label);
      });
    },
    debug(...args) {
      return sync(() => {
        console.debug(...args);
      });
    },
    dir(item, options) {
      return sync(() => {
        console.dir(item, options);
      });
    },
    dirxml(...args) {
      return sync(() => {
        console.dirxml(...args);
      });
    },
    error(...args) {
      return sync(() => {
        console.error(...args);
      });
    },
    group(options) {
      return options?.collapsed ? sync(() => console.groupCollapsed(options?.label)) : sync(() => console.group(options?.label));
    },
    groupEnd: /* @__PURE__ */ sync(() => {
      console.groupEnd();
    }),
    info(...args) {
      return sync(() => {
        console.info(...args);
      });
    },
    log(...args) {
      return sync(() => {
        console.log(...args);
      });
    },
    table(tabularData, properties) {
      return sync(() => {
        console.table(tabularData, properties);
      });
    },
    time(label) {
      return sync(() => console.time(label));
    },
    timeEnd(label) {
      return sync(() => console.timeEnd(label));
    },
    timeLog(label, ...args) {
      return sync(() => {
        console.timeLog(label, ...args);
      });
    },
    trace(...args) {
      return sync(() => {
        console.trace(...args);
      });
    },
    warn(...args) {
      return sync(() => {
        console.warn(...args);
      });
    },
    unsafe: console
  };
});

// node_modules/effect/dist/esm/internal/random.js
var RandomSymbolKey = "effect/Random", RandomTypeId, randomTag, RandomImpl, shuffleWith = (elements, nextIntBounded) => {
  return suspend(() => pipe(sync(() => Array.from(elements)), flatMap7((buffer) => {
    const numbers = [];
    for (let i = buffer.length;i >= 2; i = i - 1) {
      numbers.push(i);
    }
    return pipe(numbers, forEachSequentialDiscard((n) => pipe(nextIntBounded(n), map9((k) => swap(buffer, n - 1, k)))), as(fromIterable2(buffer)));
  })));
}, swap = (buffer, index1, index2) => {
  const tmp = buffer[index1];
  buffer[index1] = buffer[index2];
  buffer[index2] = tmp;
  return buffer;
}, make23 = (seed) => new RandomImpl(hash(seed));
var init_random = __esm(() => {
  init_Chunk();
  init_Context();
  init_Function();
  init_Hash();
  init_Utils();
  init_core();
  RandomTypeId = /* @__PURE__ */ Symbol.for(RandomSymbolKey);
  randomTag = /* @__PURE__ */ GenericTag("effect/Random");
  RandomImpl = class RandomImpl {
    seed;
    [RandomTypeId] = RandomTypeId;
    PRNG;
    constructor(seed) {
      this.seed = seed;
      this.PRNG = new PCGRandom(seed);
    }
    get next() {
      return sync(() => this.PRNG.number());
    }
    get nextBoolean() {
      return map9(this.next, (n) => n > 0.5);
    }
    get nextInt() {
      return sync(() => this.PRNG.integer(Number.MAX_SAFE_INTEGER));
    }
    nextRange(min2, max2) {
      return map9(this.next, (n) => (max2 - min2) * n + min2);
    }
    nextIntBetween(min2, max2) {
      return sync(() => this.PRNG.integer(max2 - min2) + min2);
    }
    shuffle(elements) {
      return shuffleWith(elements, (n) => this.nextIntBetween(0, n));
    }
  };
});

// node_modules/effect/dist/esm/internal/tracer.js
class NativeSpan {
  name;
  parent;
  context;
  startTime;
  kind;
  _tag = "Span";
  spanId;
  traceId = "native";
  sampled = true;
  status;
  attributes;
  events = [];
  links;
  constructor(name, parent, context2, links, startTime, kind) {
    this.name = name;
    this.parent = parent;
    this.context = context2;
    this.startTime = startTime;
    this.kind = kind;
    this.status = {
      _tag: "Started",
      startTime
    };
    this.attributes = new Map;
    this.traceId = parent._tag === "Some" ? parent.value.traceId : randomHexString(32);
    this.spanId = randomHexString(16);
    this.links = Array.from(links);
  }
  end(endTime, exit2) {
    this.status = {
      _tag: "Ended",
      endTime,
      exit: exit2,
      startTime: this.status.startTime
    };
  }
  attribute(key, value) {
    this.attributes.set(key, value);
  }
  event(name, startTime, attributes) {
    this.events.push([name, startTime, attributes ?? {}]);
  }
  addLinks(links) {
    this.links.push(...links);
  }
}
var TracerTypeId, make24 = (options) => ({
  [TracerTypeId]: TracerTypeId,
  ...options
}), tracerTag, spanTag, randomHexString, nativeTracer, addSpanStackTrace = (options) => {
  if (options?.captureStackTrace === false) {
    return options;
  } else if (options?.captureStackTrace !== undefined && typeof options.captureStackTrace !== "boolean") {
    return options;
  }
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 3;
  const traceError = new Error;
  Error.stackTraceLimit = limit;
  let cache = false;
  return {
    ...options,
    captureStackTrace: () => {
      if (cache !== false) {
        return cache;
      }
      if (traceError.stack !== undefined) {
        const stack = traceError.stack.split(`
`);
        if (stack[3] !== undefined) {
          cache = stack[3].trim();
          return cache;
        }
      }
    }
  };
}, DisablePropagation;
var init_tracer = __esm(() => {
  init_Context();
  init_Function();
  TracerTypeId = /* @__PURE__ */ Symbol.for("effect/Tracer");
  tracerTag = /* @__PURE__ */ GenericTag("effect/Tracer");
  spanTag = /* @__PURE__ */ GenericTag("effect/ParentSpan");
  randomHexString = /* @__PURE__ */ function() {
    const characters = "abcdef0123456789";
    const charactersLength = characters.length;
    return function(length2) {
      let result = "";
      for (let i = 0;i < length2; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
      }
      return result;
    };
  }();
  nativeTracer = /* @__PURE__ */ make24({
    span: (name, parent, context2, links, startTime, kind) => new NativeSpan(name, parent, context2, links, startTime, kind),
    context: (f) => f()
  });
  DisablePropagation = /* @__PURE__ */ Reference2()("effect/Tracer/DisablePropagation", {
    defaultValue: constFalse
  });
});

// node_modules/effect/dist/esm/internal/defaultServices.js
var liveServices, currentServices, sleep = (duration) => {
  const decodedDuration = decode(duration);
  return clockWith((clock) => clock.sleep(decodedDuration));
}, defaultServicesWith = (f) => withFiberRuntime((fiber) => f(fiber.currentDefaultServices)), clockWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(clockTag.key))), currentTimeMillis, currentTimeNanos, withClock, withConfigProvider, configProviderWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(configProviderTag.key))), config = (config2) => configProviderWith((_) => _.load(config2)), randomWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(randomTag.key))), withRandom, tracerWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(tracerTag.key))), withTracer;
var init_defaultServices = __esm(() => {
  init_Array();
  init_Context();
  init_Duration();
  init_Function();
  init_GlobalValue();
  init_clock();
  init_configProvider();
  init_core();
  init_console();
  init_random();
  init_tracer();
  liveServices = /* @__PURE__ */ pipe(/* @__PURE__ */ empty4(), /* @__PURE__ */ add2(clockTag, /* @__PURE__ */ make20()), /* @__PURE__ */ add2(consoleTag, defaultConsole), /* @__PURE__ */ add2(randomTag, /* @__PURE__ */ make23(/* @__PURE__ */ Math.random())), /* @__PURE__ */ add2(configProviderTag, /* @__PURE__ */ fromEnv()), /* @__PURE__ */ add2(tracerTag, nativeTracer));
  currentServices = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/DefaultServices/currentServices"), () => fiberRefUnsafeMakeContext(liveServices));
  currentTimeMillis = /* @__PURE__ */ clockWith((clock) => clock.currentTimeMillis);
  currentTimeNanos = /* @__PURE__ */ clockWith((clock) => clock.currentTimeNanos);
  withClock = /* @__PURE__ */ dual(2, (effect, c) => fiberRefLocallyWith(currentServices, add2(clockTag, c))(effect));
  withConfigProvider = /* @__PURE__ */ dual(2, (self, provider) => fiberRefLocallyWith(currentServices, add2(configProviderTag, provider))(self));
  withRandom = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(currentServices, add2(randomTag, value))(effect));
  withTracer = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(currentServices, add2(tracerTag, value))(effect));
});

// node_modules/effect/dist/esm/Clock.js
var sleep2, currentTimeMillis2, currentTimeNanos2, clockWith2, Clock;
var init_Clock = __esm(() => {
  init_clock();
  init_defaultServices();
  sleep2 = sleep;
  currentTimeMillis2 = currentTimeMillis;
  currentTimeNanos2 = currentTimeNanos;
  clockWith2 = clockWith;
  Clock = clockTag;
});

// node_modules/effect/dist/esm/internal/fiberRefs.js
function unsafeMake5(fiberRefLocals) {
  return new FiberRefsImpl(fiberRefLocals);
}
function empty24() {
  return unsafeMake5(new Map);
}
var FiberRefsSym, FiberRefsImpl, findAncestor = (_ref, _parentStack, _childStack, _childModified = false) => {
  const ref = _ref;
  let parentStack = _parentStack;
  let childStack = _childStack;
  let childModified = _childModified;
  let ret2 = undefined;
  while (ret2 === undefined) {
    if (isNonEmptyReadonlyArray(parentStack) && isNonEmptyReadonlyArray(childStack)) {
      const parentFiberId = headNonEmpty(parentStack)[0];
      const parentAncestors = tailNonEmpty(parentStack);
      const childFiberId = headNonEmpty(childStack)[0];
      const childRefValue = headNonEmpty(childStack)[1];
      const childAncestors = tailNonEmpty(childStack);
      if (parentFiberId.startTimeMillis < childFiberId.startTimeMillis) {
        childStack = childAncestors;
        childModified = true;
      } else if (parentFiberId.startTimeMillis > childFiberId.startTimeMillis) {
        parentStack = parentAncestors;
      } else {
        if (parentFiberId.id < childFiberId.id) {
          childStack = childAncestors;
          childModified = true;
        } else if (parentFiberId.id > childFiberId.id) {
          parentStack = parentAncestors;
        } else {
          ret2 = [childRefValue, childModified];
        }
      }
    } else {
      ret2 = [ref.initial, true];
    }
  }
  return ret2;
}, joinAs, forkAs, unsafeForkAs = (self, map10, fiberId2) => {
  self.locals.forEach((stack, fiberRef) => {
    const oldValue = stack[0][1];
    const newValue = fiberRef.patch(fiberRef.fork)(oldValue);
    if (equals(oldValue, newValue)) {
      map10.set(fiberRef, stack);
    } else {
      map10.set(fiberRef, [[fiberId2, newValue], ...stack]);
    }
  });
}, fiberRefs = (self) => fromIterable5(self.locals.keys()), setAll = (self) => forEachSequentialDiscard(fiberRefs(self), (fiberRef) => fiberRefSet(fiberRef, getOrDefault(self, fiberRef))), delete_, get9, getOrDefault, updateAs, unsafeUpdateAs = (locals, fiberId2, fiberRef, value) => {
  const oldStack = locals.get(fiberRef) ?? [];
  let newStack;
  if (isNonEmptyReadonlyArray(oldStack)) {
    const [currentId, currentValue] = headNonEmpty(oldStack);
    if (currentId[symbol2](fiberId2)) {
      if (equals(currentValue, value)) {
        return;
      } else {
        newStack = [[fiberId2, value], ...oldStack.slice(1)];
      }
    } else {
      newStack = [[fiberId2, value], ...oldStack];
    }
  } else {
    newStack = [[fiberId2, value]];
  }
  locals.set(fiberRef, newStack);
}, updateManyAs;
var init_fiberRefs = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_HashSet();
  init_Option();
  init_core();
  FiberRefsSym = /* @__PURE__ */ Symbol.for("effect/FiberRefs");
  FiberRefsImpl = class FiberRefsImpl {
    locals;
    [FiberRefsSym] = FiberRefsSym;
    constructor(locals) {
      this.locals = locals;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  joinAs = /* @__PURE__ */ dual(3, (self, fiberId2, that) => {
    const parentFiberRefs = new Map(self.locals);
    that.locals.forEach((childStack, fiberRef) => {
      const childValue = childStack[0][1];
      if (!childStack[0][0][symbol2](fiberId2)) {
        if (!parentFiberRefs.has(fiberRef)) {
          if (equals(childValue, fiberRef.initial)) {
            return;
          }
          parentFiberRefs.set(fiberRef, [[fiberId2, fiberRef.join(fiberRef.initial, childValue)]]);
          return;
        }
        const parentStack = parentFiberRefs.get(fiberRef);
        const [ancestor, wasModified] = findAncestor(fiberRef, parentStack, childStack);
        if (wasModified) {
          const patch9 = fiberRef.diff(ancestor, childValue);
          const oldValue = parentStack[0][1];
          const newValue = fiberRef.join(oldValue, fiberRef.patch(patch9)(oldValue));
          if (!equals(oldValue, newValue)) {
            let newStack;
            const parentFiberId = parentStack[0][0];
            if (parentFiberId[symbol2](fiberId2)) {
              newStack = [[parentFiberId, newValue], ...parentStack.slice(1)];
            } else {
              newStack = [[fiberId2, newValue], ...parentStack];
            }
            parentFiberRefs.set(fiberRef, newStack);
          }
        }
      }
    });
    return new FiberRefsImpl(parentFiberRefs);
  });
  forkAs = /* @__PURE__ */ dual(2, (self, childId) => {
    const map10 = new Map;
    unsafeForkAs(self, map10, childId);
    return new FiberRefsImpl(map10);
  });
  delete_ = /* @__PURE__ */ dual(2, (self, fiberRef) => {
    const locals = new Map(self.locals);
    locals.delete(fiberRef);
    return new FiberRefsImpl(locals);
  });
  get9 = /* @__PURE__ */ dual(2, (self, fiberRef) => {
    if (!self.locals.has(fiberRef)) {
      return none2();
    }
    return some2(headNonEmpty(self.locals.get(fiberRef))[1]);
  });
  getOrDefault = /* @__PURE__ */ dual(2, (self, fiberRef) => pipe(get9(self, fiberRef), getOrElse(() => fiberRef.initial)));
  updateAs = /* @__PURE__ */ dual(2, (self, {
    fiberId: fiberId2,
    fiberRef,
    value
  }) => {
    if (self.locals.size === 0) {
      return new FiberRefsImpl(new Map([[fiberRef, [[fiberId2, value]]]]));
    }
    const locals = new Map(self.locals);
    unsafeUpdateAs(locals, fiberId2, fiberRef, value);
    return new FiberRefsImpl(locals);
  });
  updateManyAs = /* @__PURE__ */ dual(2, (self, {
    entries: entries2,
    forkAs: forkAs2
  }) => {
    if (self.locals.size === 0) {
      return new FiberRefsImpl(new Map(entries2));
    }
    const locals = new Map(self.locals);
    if (forkAs2 !== undefined) {
      unsafeForkAs(self, locals, forkAs2);
    }
    entries2.forEach(([fiberRef, values3]) => {
      if (values3.length === 1) {
        unsafeUpdateAs(locals, values3[0][0], fiberRef, values3[0][1]);
      } else {
        values3.forEach(([fiberId2, value]) => {
          unsafeUpdateAs(locals, fiberId2, fiberRef, value);
        });
      }
    });
    return new FiberRefsImpl(locals);
  });
});

// node_modules/effect/dist/esm/FiberRefs.js
var get10, getOrDefault2, joinAs2, setAll2, updateManyAs2, empty25;
var init_FiberRefs = __esm(() => {
  init_fiberRefs();
  get10 = get9;
  getOrDefault2 = getOrDefault;
  joinAs2 = joinAs;
  setAll2 = setAll;
  updateManyAs2 = updateManyAs;
  empty25 = empty24;
});

// node_modules/effect/dist/esm/LogLevel.js
var All, Fatal, Error2, Warning, Info, Debug, Trace, None3, Order2, greaterThan2, fromLiteral = (literal) => {
  switch (literal) {
    case "All":
      return All;
    case "Debug":
      return Debug;
    case "Error":
      return Error2;
    case "Fatal":
      return Fatal;
    case "Info":
      return Info;
    case "Trace":
      return Trace;
    case "None":
      return None3;
    case "Warning":
      return Warning;
  }
};
var init_LogLevel = __esm(() => {
  init_Function();
  init_core();
  init_Number();
  init_Order();
  All = logLevelAll;
  Fatal = logLevelFatal;
  Error2 = logLevelError;
  Warning = logLevelWarning;
  Info = logLevelInfo;
  Debug = logLevelDebug;
  Trace = logLevelTrace;
  None3 = logLevelNone;
  Order2 = /* @__PURE__ */ pipe(Order, /* @__PURE__ */ mapInput2((level) => level.ordinal));
  greaterThan2 = /* @__PURE__ */ greaterThan(Order2);
});

// node_modules/effect/dist/esm/internal/logSpan.js
var make25 = (label, startTime) => ({
  label,
  startTime
}), formatLabel = (key) => key.replace(/[\s="]/g, "_"), render = (now) => (self) => {
  const label = formatLabel(self.label);
  return `${label}=${now - self.startTime}ms`;
};

// node_modules/effect/dist/esm/LogSpan.js
var make26;
var init_LogSpan = __esm(() => {
  make26 = make25;
});

// node_modules/effect/dist/esm/Effectable.js
var EffectPrototype2, CommitPrototype2, Base2, Class;
var init_Effectable = __esm(() => {
  init_effectable();
  EffectPrototype2 = EffectPrototype;
  CommitPrototype2 = CommitPrototype;
  Base2 = Base;
  Class = class Class extends Base2 {
  };
});

// node_modules/effect/dist/esm/Readable.js
var TypeId13, Proto;
var init_Readable = __esm(() => {
  init_Function();
  init_core();
  init_Predicate();
  TypeId13 = /* @__PURE__ */ Symbol.for("effect/Readable");
  Proto = {
    [TypeId13]: TypeId13,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/ref.js
var RefTypeId, refVariance, RefImpl, unsafeMake6 = (value) => new RefImpl(make12(value)), make27 = (value) => sync(() => unsafeMake6(value)), get11 = (self) => self.get, set5, getAndSet, modify2, update2;
var init_ref = __esm(() => {
  init_Effectable();
  init_Function();
  init_MutableRef();
  init_Option();
  init_Readable();
  init_core();
  RefTypeId = /* @__PURE__ */ Symbol.for("effect/Ref");
  refVariance = {
    _A: (_) => _
  };
  RefImpl = class RefImpl extends Class {
    ref;
    commit() {
      return this.get;
    }
    [RefTypeId] = refVariance;
    [TypeId13] = TypeId13;
    constructor(ref) {
      super();
      this.ref = ref;
      this.get = sync(() => get6(this.ref));
    }
    get;
    modify(f) {
      return sync(() => {
        const current = get6(this.ref);
        const [b, a] = f(current);
        if (current !== a) {
          set2(a)(this.ref);
        }
        return b;
      });
    }
  };
  set5 = /* @__PURE__ */ dual(2, (self, value) => self.modify(() => [undefined, value]));
  getAndSet = /* @__PURE__ */ dual(2, (self, value) => self.modify((a) => [a, value]));
  modify2 = /* @__PURE__ */ dual(2, (self, f) => self.modify(f));
  update2 = /* @__PURE__ */ dual(2, (self, f) => self.modify((a) => [undefined, f(a)]));
});

// node_modules/effect/dist/esm/Ref.js
var make28, get12, getAndSet2, modify3, update3;
var init_Ref = __esm(() => {
  init_ref();
  make28 = make27;
  get12 = get11;
  getAndSet2 = getAndSet;
  modify3 = modify2;
  update3 = update2;
});

// node_modules/effect/dist/esm/Tracer.js
var tracerWith2;
var init_Tracer = __esm(() => {
  init_defaultServices();
  init_tracer();
  tracerWith2 = tracerWith;
});

// node_modules/effect/dist/esm/internal/fiberRefs/patch.js
var OP_EMPTY2 = "Empty", OP_ADD = "Add", OP_REMOVE = "Remove", OP_UPDATE = "Update", OP_AND_THEN = "AndThen", empty26, diff8 = (oldValue, newValue) => {
  const missingLocals = new Map(oldValue.locals);
  let patch9 = empty26;
  for (const [fiberRef, pairs] of newValue.locals.entries()) {
    const newValue2 = headNonEmpty(pairs)[1];
    const old = missingLocals.get(fiberRef);
    if (old !== undefined) {
      const oldValue2 = headNonEmpty(old)[1];
      if (!equals(oldValue2, newValue2)) {
        patch9 = combine10({
          _tag: OP_UPDATE,
          fiberRef,
          patch: fiberRef.diff(oldValue2, newValue2)
        })(patch9);
      }
    } else {
      patch9 = combine10({
        _tag: OP_ADD,
        fiberRef,
        value: newValue2
      })(patch9);
    }
    missingLocals.delete(fiberRef);
  }
  for (const [fiberRef] of missingLocals.entries()) {
    patch9 = combine10({
      _tag: OP_REMOVE,
      fiberRef
    })(patch9);
  }
  return patch9;
}, combine10, patch9;
var init_patch = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_fiberRefs();
  empty26 = {
    _tag: OP_EMPTY2
  };
  combine10 = /* @__PURE__ */ dual(2, (self, that) => ({
    _tag: OP_AND_THEN,
    first: self,
    second: that
  }));
  patch9 = /* @__PURE__ */ dual(3, (self, fiberId2, oldValue) => {
    let fiberRefs2 = oldValue;
    let patches = of(self);
    while (isNonEmptyReadonlyArray(patches)) {
      const head3 = headNonEmpty(patches);
      const tail = tailNonEmpty(patches);
      switch (head3._tag) {
        case OP_EMPTY2: {
          patches = tail;
          break;
        }
        case OP_ADD: {
          fiberRefs2 = updateAs(fiberRefs2, {
            fiberId: fiberId2,
            fiberRef: head3.fiberRef,
            value: head3.value
          });
          patches = tail;
          break;
        }
        case OP_REMOVE: {
          fiberRefs2 = delete_(fiberRefs2, head3.fiberRef);
          patches = tail;
          break;
        }
        case OP_UPDATE: {
          const value = getOrDefault(fiberRefs2, head3.fiberRef);
          fiberRefs2 = updateAs(fiberRefs2, {
            fiberId: fiberId2,
            fiberRef: head3.fiberRef,
            value: head3.fiberRef.patch(head3.patch)(value)
          });
          patches = tail;
          break;
        }
        case OP_AND_THEN: {
          patches = prepend(head3.first)(prepend(head3.second)(tail));
          break;
        }
      }
    }
    return fiberRefs2;
  });
});

// node_modules/effect/dist/esm/internal/metric/label.js
var MetricLabelSymbolKey = "effect/MetricLabel", MetricLabelTypeId, MetricLabelImpl, make29 = (key, value) => {
  return new MetricLabelImpl(key, value);
}, isMetricLabel = (u) => hasProperty(u, MetricLabelTypeId);
var init_label = __esm(() => {
  init_Equal();
  init_Hash();
  init_Predicate();
  MetricLabelTypeId = /* @__PURE__ */ Symbol.for(MetricLabelSymbolKey);
  MetricLabelImpl = class MetricLabelImpl {
    key;
    value;
    [MetricLabelTypeId] = MetricLabelTypeId;
    _hash;
    constructor(key, value) {
      this.key = key;
      this.value = value;
      this._hash = string(MetricLabelSymbolKey + this.key + this.value);
    }
    [symbol]() {
      return this._hash;
    }
    [symbol2](that) {
      return isMetricLabel(that) && this.key === that.key && this.value === that.value;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/core-effect.js
var annotateLogs, asSome = (self) => map9(self, some2), asSomeError = (self) => mapError(self, some2), try_ = (arg) => {
  let evaluate;
  let onFailure = undefined;
  if (typeof arg === "function") {
    evaluate = arg;
  } else {
    evaluate = arg.try;
    onFailure = arg.catch;
  }
  return suspend(() => {
    try {
      return succeed(internalCall(evaluate));
    } catch (error) {
      return fail2(onFailure ? internalCall(() => onFailure(error)) : new UnknownException(error, "An unknown error occurred in Effect.try"));
    }
  });
}, _catch, catchAllDefect, catchSomeCause, catchSomeDefect, catchTag, catchTags, cause = (self) => matchCause(self, {
  onFailure: identity,
  onSuccess: () => empty20
}), clockWith3, clock, delay, descriptorWith = (f) => withFiberRuntime((state, status) => f({
  id: state.id(),
  status,
  interruptors: interruptors(state.getFiberRef(currentInterruptedCause))
})), allowInterrupt, descriptor, diffFiberRefs = (self) => summarized(self, fiberRefs2, diff8), diffFiberRefsAndRuntimeFlags = (self) => summarized(self, zip2(fiberRefs2, runtimeFlags), ([refs, flags], [refsNew, flagsNew]) => [diff8(refs, refsNew), diff7(flags, flagsNew)]), Do, bind2, bindTo2, let_2, dropUntil, dropWhile, contextWith = (f) => map9(context(), f), eventually = (self) => orElse2(self, () => flatMap7(yieldNow(), () => eventually(self))), filterMap3, filterOrDie, filterOrDieMessage, filterOrElse, liftPredicate, filterOrFail, findFirst4, findLoop = (iterator, index, f, value) => flatMap7(f(value, index), (result) => {
  if (result) {
    return succeed(some2(value));
  }
  const next = iterator.next();
  if (!next.done) {
    return findLoop(iterator, index + 1, f, next.value);
  }
  return succeed(none2());
}), firstSuccessOf = (effects) => suspend(() => {
  const list = fromIterable2(effects);
  if (!isNonEmpty2(list)) {
    return dieSync(() => new IllegalArgumentException(`Received an empty collection of effects`));
  }
  return pipe(tailNonEmpty2(list), reduce(headNonEmpty2(list), (left3, right3) => orElse2(left3, () => right3)));
}), flipWith, match6, every5, forAllLoop = (iterator, index, f) => {
  const next = iterator.next();
  return next.done ? succeed(true) : flatMap7(f(next.value, index), (b) => b ? forAllLoop(iterator, index + 1, f) : succeed(b));
}, forever = (self) => {
  const loop = flatMap7(flatMap7(self, () => yieldNow()), () => loop);
  return loop;
}, fiberRefs2, head3 = (self) => flatMap7(self, (as2) => {
  const iterator = as2[Symbol.iterator]();
  const next = iterator.next();
  if (next.done) {
    return fail2(new NoSuchElementException);
  }
  return succeed(next.value);
}), ignore = (self) => match6(self, {
  onFailure: constVoid,
  onSuccess: constVoid
}), ignoreLogged = (self) => matchCauseEffect(self, {
  onFailure: (cause2) => logDebug(cause2, "An error was silently ignored because it is not anticipated to be useful"),
  onSuccess: () => void_
}), inheritFiberRefs = (childFiberRefs) => updateFiberRefs((parentFiberId, parentFiberRefs) => joinAs2(parentFiberRefs, parentFiberId, childFiberRefs)), isFailure = (self) => match6(self, {
  onFailure: constTrue,
  onSuccess: constFalse
}), isSuccess2 = (self) => match6(self, {
  onFailure: constFalse,
  onSuccess: constTrue
}), iterate = (initial, options) => suspend(() => {
  if (options.while(initial)) {
    return flatMap7(options.body(initial), (z2) => iterate(z2, options));
  }
  return succeed(initial);
}), logWithLevel = (level) => (...message) => {
  const levelOption = fromNullable(level);
  let cause2 = undefined;
  for (let i = 0, len = message.length;i < len; i++) {
    const msg = message[i];
    if (isCause(msg)) {
      if (cause2 !== undefined) {
        cause2 = sequential(cause2, msg);
      } else {
        cause2 = msg;
      }
      message = [...message.slice(0, i), ...message.slice(i + 1)];
      i--;
    }
  }
  if (cause2 === undefined) {
    cause2 = empty20;
  }
  return withFiberRuntime((fiberState) => {
    fiberState.log(message, cause2, levelOption);
    return void_;
  });
}, log, logTrace, logDebug, logInfo, logWarning, logError, logFatal, withLogSpan, logAnnotations, loop = (initial, options) => options.discard ? loopDiscard(initial, options.while, options.step, options.body) : map9(loopInternal(initial, options.while, options.step, options.body), fromIterable), loopInternal = (initial, cont, inc, body) => suspend(() => cont(initial) ? flatMap7(body(initial), (a) => map9(loopInternal(inc(initial), cont, inc, body), prepend3(a))) : sync(() => empty10())), loopDiscard = (initial, cont, inc, body) => suspend(() => cont(initial) ? flatMap7(body(initial), () => loopDiscard(inc(initial), cont, inc, body)) : void_), mapAccum2, mapErrorCause, memoize = (self) => pipe(deferredMake(), flatMap7((deferred) => pipe(diffFiberRefsAndRuntimeFlags(self), intoDeferred(deferred), once, map9((complete) => zipRight(complete, pipe(deferredAwait(deferred), flatMap7(([patch10, a]) => as(zip2(patchFiberRefs(patch10[0]), updateRuntimeFlags(patch10[1])), a)))))))), merge5 = (self) => matchEffect(self, {
  onFailure: (e) => succeed(e),
  onSuccess: succeed
}), negate = (self) => map9(self, (b) => !b), none6 = (self) => flatMap7(self, (option) => {
  switch (option._tag) {
    case "None":
      return void_;
    case "Some":
      return fail2(new NoSuchElementException);
  }
}), once = (self) => map9(make28(true), (ref) => asVoid(whenEffect(self, getAndSet2(ref, false)))), option = (self) => matchEffect(self, {
  onFailure: () => succeed(none2()),
  onSuccess: (a) => succeed(some2(a))
}), orElseFail, orElseSucceed, parallelErrors = (self) => matchCauseEffect(self, {
  onFailure: (cause2) => {
    const errors = fromIterable(failures(cause2));
    return errors.length === 0 ? failCause(cause2) : fail2(errors);
  },
  onSuccess: succeed
}), patchFiberRefs = (patch10) => updateFiberRefs((fiberId2, fiberRefs3) => pipe(patch10, patch9(fiberId2, fiberRefs3))), promise = (evaluate) => evaluate.length >= 1 ? async_((resolve, signal) => {
  try {
    evaluate(signal).then((a) => resolve(exitSucceed(a)), (e) => resolve(exitDie(e)));
  } catch (e) {
    resolve(exitDie(e));
  }
}) : async_((resolve) => {
  try {
    evaluate().then((a) => resolve(exitSucceed(a)), (e) => resolve(exitDie(e)));
  } catch (e) {
    resolve(exitDie(e));
  }
}), provideService, provideServiceEffect, random2, reduce9, reduceRight2, reduceWhile, reduceWhileLoop = (iterator, index, state, predicate, f) => {
  const next = iterator.next();
  if (!next.done && predicate(state)) {
    return flatMap7(f(state, next.value, index), (nextState) => reduceWhileLoop(iterator, index + 1, nextState, predicate, f));
  }
  return succeed(state);
}, repeatN, repeatNLoop = (self, n) => flatMap7(self, (a) => n <= 0 ? succeed(a) : zipRight(yieldNow(), repeatNLoop(self, n - 1))), sandbox = (self) => matchCauseEffect(self, {
  onFailure: fail2,
  onSuccess: succeed
}), setFiberRefs = (fiberRefs3) => suspend(() => setAll2(fiberRefs3)), sleep3, succeedNone, succeedSome = (value) => succeed(some2(value)), summarized, tagMetrics, labelMetrics, takeUntil, takeWhile, tapBoth, tapDefect, tapError, tapErrorTag, tapErrorCause, timed = (self) => timedWith(self, currentTimeNanos2), timedWith, tracerWith3, tracer, tryPromise = (arg) => {
  let evaluate;
  let catcher = undefined;
  if (typeof arg === "function") {
    evaluate = arg;
  } else {
    evaluate = arg.try;
    catcher = arg.catch;
  }
  const fail4 = (e) => catcher ? failSync(() => catcher(e)) : fail2(new UnknownException(e, "An unknown error occurred in Effect.tryPromise"));
  if (evaluate.length >= 1) {
    return async_((resolve, signal) => {
      try {
        evaluate(signal).then((a) => resolve(exitSucceed(a)), (e) => resolve(fail4(e)));
      } catch (e) {
        resolve(fail4(e));
      }
    });
  }
  return async_((resolve) => {
    try {
      evaluate().then((a) => resolve(exitSucceed(a)), (e) => resolve(fail4(e)));
    } catch (e) {
      resolve(fail4(e));
    }
  });
}, tryMap, tryMapPromise, unless, unlessEffect, unsandbox = (self) => mapErrorCause(self, flatten4), updateFiberRefs = (f) => withFiberRuntime((state) => {
  state.setFiberRefs(f(state.id(), state.getFiberRefs()));
  return void_;
}), updateService, when, whenFiberRef, whenRef, withMetric, serviceFunctionEffect = (getService, f) => (...args) => flatMap7(getService, (a) => f(a)(...args)), serviceFunction = (getService, f) => (...args) => map9(getService, (a) => f(a)(...args)), serviceFunctions = (getService) => new Proxy({}, {
  get(_target, prop, _receiver) {
    return (...args) => flatMap7(getService, (s) => s[prop](...args));
  }
}), serviceConstants = (getService) => new Proxy({}, {
  get(_target, prop, _receiver) {
    return flatMap7(getService, (s) => isEffect(s[prop]) ? s[prop] : succeed(s[prop]));
  }
}), serviceMembers = (getService) => ({
  functions: serviceFunctions(getService),
  constants: serviceConstants(getService)
}), serviceOption = (tag) => map9(context(), getOption2(tag)), serviceOptional = (tag) => flatMap7(context(), getOption2(tag)), annotateCurrentSpan = function() {
  const args = arguments;
  return ignore(flatMap7(currentSpan, (span2) => sync(() => {
    if (typeof args[0] === "string") {
      span2.attribute(args[0], args[1]);
    } else {
      for (const key in args[0]) {
        span2.attribute(key, args[0][key]);
      }
    }
  })));
}, linkSpanCurrent = function() {
  const args = arguments;
  const links = Array.isArray(args[0]) ? args[0] : [{
    _tag: "SpanLink",
    span: args[0],
    attributes: args[1] ?? {}
  }];
  return ignore(flatMap7(currentSpan, (span2) => sync(() => span2.addLinks(links))));
}, annotateSpans, currentParentSpan, currentSpan, linkSpans, bigint03, filterDisablePropagation, unsafeMakeSpan = (fiber, name, options) => {
  const disablePropagation = !fiber.getFiberRef(currentTracerEnabled) || options.context && get3(options.context, DisablePropagation);
  const context2 = fiber.getFiberRef(currentContext);
  const parent = options.parent ? some2(options.parent) : options.root ? none2() : filterDisablePropagation(getOption2(context2, spanTag));
  let span2;
  if (disablePropagation) {
    span2 = noopSpan({
      name,
      parent,
      context: add2(options.context ?? empty4(), DisablePropagation, true)
    });
  } else {
    const services = fiber.getFiberRef(currentServices);
    const tracer2 = get3(services, tracerTag);
    const clock2 = get3(services, Clock);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const fiberRefs3 = fiber.getFiberRefs();
    const annotationsFromEnv = get10(fiberRefs3, currentTracerSpanAnnotations);
    const linksFromEnv = get10(fiberRefs3, currentTracerSpanLinks);
    const links = linksFromEnv._tag === "Some" ? options.links !== undefined ? [...toReadonlyArray(linksFromEnv.value), ...options.links ?? []] : toReadonlyArray(linksFromEnv.value) : options.links ?? empty2();
    span2 = tracer2.span(name, parent, options.context ?? empty4(), links, timingEnabled ? clock2.unsafeCurrentTimeNanos() : bigint03, options.kind ?? "internal");
    if (annotationsFromEnv._tag === "Some") {
      forEach4(annotationsFromEnv.value, (value, key) => span2.attribute(key, value));
    }
    if (options.attributes !== undefined) {
      Object.entries(options.attributes).forEach(([k, v]) => span2.attribute(k, v));
    }
  }
  if (typeof options.captureStackTrace === "function") {
    spanToTrace.set(span2, options.captureStackTrace);
  }
  return span2;
}, makeSpan = (name, options) => {
  options = addSpanStackTrace(options);
  return withFiberRuntime((fiber) => succeed(unsafeMakeSpan(fiber, name, options)));
}, spanAnnotations, spanLinks, endSpan = (span2, exit2, clock2, timingEnabled) => sync(() => {
  if (span2.status._tag === "Ended") {
    return;
  }
  if (exitIsFailure(exit2) && spanToTrace.has(span2)) {
    span2.attribute("code.stacktrace", spanToTrace.get(span2)());
  }
  span2.end(timingEnabled ? clock2.unsafeCurrentTimeNanos() : bigint03, exit2);
}), useSpan = (name, ...args) => {
  const options = addSpanStackTrace(args.length === 1 ? undefined : args[0]);
  const evaluate = args[args.length - 1];
  return withFiberRuntime((fiber) => {
    const span2 = unsafeMakeSpan(fiber, name, options);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const clock2 = get3(fiber.getFiberRef(currentServices), clockTag);
    return onExit(evaluate(span2), (exit2) => endSpan(span2, exit2, clock2, timingEnabled));
  });
}, withParentSpan, withSpan = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return useSpan(name, options, (span2) => withParentSpan(self, span2));
  }
  return (self) => useSpan(name, options, (span2) => withParentSpan(self, span2));
}, functionWithSpan = (options) => function() {
  let captureStackTrace = options.captureStackTrace ?? false;
  if (options.captureStackTrace !== false) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const error = new Error;
    Error.stackTraceLimit = limit;
    let cache = false;
    captureStackTrace = () => {
      if (cache !== false) {
        return cache;
      }
      if (error.stack) {
        const stack = error.stack.trim().split(`
`);
        cache = stack.slice(2).join(`
`).trim();
        return cache;
      }
    };
  }
  return suspend(() => {
    const opts = typeof options.options === "function" ? options.options.apply(null, arguments) : options.options;
    return withSpan(suspend(() => internalCall(() => options.body.apply(this, arguments))), opts.name, {
      ...opts,
      captureStackTrace
    });
  });
}, fromNullable2 = (value) => value == null ? fail2(new NoSuchElementException) : succeed(value), optionFromOptional = (self) => catchAll(map9(self, some2), (error) => isNoSuchElementException(error) ? succeedNone : fail2(error));
var init_core_effect = __esm(() => {
  init_Array();
  init_Chunk();
  init_Clock();
  init_Context();
  init_Duration();
  init_FiberRefs();
  init_Function();
  init_HashMap();
  init_HashSet();
  init_List();
  init_LogLevel();
  init_LogSpan();
  init_Option();
  init_Predicate();
  init_Ref();
  init_Tracer();
  init_Utils();
  init_cause();
  init_clock();
  init_core();
  init_defaultServices();
  init_doNotation();
  init_patch();
  init_label();
  init_runtimeFlags();
  init_tracer();
  annotateLogs = /* @__PURE__ */ dual((args) => isEffect(args[0]), function() {
    const args = arguments;
    return fiberRefLocallyWith(args[0], currentLogAnnotations, typeof args[1] === "string" ? set3(args[1], args[2]) : (annotations2) => Object.entries(args[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations2));
  });
  _catch = /* @__PURE__ */ dual(3, (self, tag, options) => catchAll(self, (e) => {
    if (hasProperty(e, tag) && e[tag] === options.failure) {
      return options.onFailure(e);
    }
    return fail2(e);
  }));
  catchAllDefect = /* @__PURE__ */ dual(2, (self, f) => catchAllCause(self, (cause) => {
    const option = find(cause, (_) => isDieType(_) ? some2(_) : none2());
    switch (option._tag) {
      case "None": {
        return failCause(cause);
      }
      case "Some": {
        return f(option.value.defect);
      }
    }
  }));
  catchSomeCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const option = f(cause);
      switch (option._tag) {
        case "None": {
          return failCause(cause);
        }
        case "Some": {
          return option.value;
        }
      }
    },
    onSuccess: succeed
  }));
  catchSomeDefect = /* @__PURE__ */ dual(2, (self, pf) => catchAllCause(self, (cause) => {
    const option = find(cause, (_) => isDieType(_) ? some2(_) : none2());
    switch (option._tag) {
      case "None": {
        return failCause(cause);
      }
      case "Some": {
        const optionEffect = pf(option.value.defect);
        return optionEffect._tag === "Some" ? optionEffect.value : failCause(cause);
      }
    }
  }));
  catchTag = /* @__PURE__ */ dual(3, (self, k, f) => catchIf(self, isTagged(k), f));
  catchTags = /* @__PURE__ */ dual(2, (self, cases) => {
    let keys3;
    return catchIf(self, (e) => {
      keys3 ??= Object.keys(cases);
      return hasProperty(e, "_tag") && isString(e["_tag"]) && keys3.includes(e["_tag"]);
    }, (e) => cases[e["_tag"]](e));
  });
  clockWith3 = clockWith2;
  clock = /* @__PURE__ */ clockWith3(succeed);
  delay = /* @__PURE__ */ dual(2, (self, duration) => zipRight(sleep2(duration), self));
  allowInterrupt = /* @__PURE__ */ descriptorWith((descriptor) => size3(descriptor.interruptors) > 0 ? interrupt2 : void_);
  descriptor = /* @__PURE__ */ descriptorWith(succeed);
  Do = /* @__PURE__ */ succeed({});
  bind2 = /* @__PURE__ */ bind(map9, flatMap7);
  bindTo2 = /* @__PURE__ */ bindTo(map9);
  let_2 = /* @__PURE__ */ let_(map9);
  dropUntil = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let dropping = succeed(false);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      dropping = flatMap7(dropping, (bool) => {
        if (bool) {
          builder.push(a);
          return succeed(true);
        }
        return predicate(a, index);
      });
    }
    return map9(dropping, () => builder);
  }));
  dropWhile = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let dropping = succeed(true);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      dropping = flatMap7(dropping, (d) => map9(d ? predicate(a, index) : succeed(false), (b) => {
        if (!b) {
          builder.push(a);
        }
        return b;
      }));
    }
    return map9(dropping, () => builder);
  }));
  filterMap3 = /* @__PURE__ */ dual(2, (elements, pf) => map9(forEachSequential(elements, identity), filterMap(pf)));
  filterOrDie = /* @__PURE__ */ dual(3, (self, predicate, orDieWith2) => filterOrElse(self, predicate, (a) => dieSync(() => orDieWith2(a))));
  filterOrDieMessage = /* @__PURE__ */ dual(3, (self, predicate, message) => filterOrElse(self, predicate, () => dieMessage(message)));
  filterOrElse = /* @__PURE__ */ dual(3, (self, predicate, orElse3) => flatMap7(self, (a) => predicate(a) ? succeed(a) : orElse3(a)));
  liftPredicate = /* @__PURE__ */ dual(3, (self, predicate, orFailWith) => suspend(() => predicate(self) ? succeed(self) : fail2(orFailWith(self))));
  filterOrFail = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, predicate, orFailWith) => filterOrElse(self, predicate, (a) => orFailWith === undefined ? fail2(new NoSuchElementException) : failSync(() => orFailWith(a))));
  findFirst4 = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const next = iterator.next();
    if (!next.done) {
      return findLoop(iterator, 0, predicate, next.value);
    }
    return succeed(none2());
  }));
  flipWith = /* @__PURE__ */ dual(2, (self, f) => flip(f(flip(self))));
  match6 = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
    onFailure: (e) => succeed(options.onFailure(e)),
    onSuccess: (a) => succeed(options.onSuccess(a))
  }));
  every5 = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => forAllLoop(elements[Symbol.iterator](), 0, predicate)));
  fiberRefs2 = /* @__PURE__ */ withFiberRuntime((state) => succeed(state.getFiberRefs()));
  log = /* @__PURE__ */ logWithLevel();
  logTrace = /* @__PURE__ */ logWithLevel(Trace);
  logDebug = /* @__PURE__ */ logWithLevel(Debug);
  logInfo = /* @__PURE__ */ logWithLevel(Info);
  logWarning = /* @__PURE__ */ logWithLevel(Warning);
  logError = /* @__PURE__ */ logWithLevel(Error2);
  logFatal = /* @__PURE__ */ logWithLevel(Fatal);
  withLogSpan = /* @__PURE__ */ dual(2, (effect, label) => flatMap7(currentTimeMillis2, (now) => fiberRefLocallyWith(effect, currentLogSpan, prepend3(make26(label, now)))));
  logAnnotations = /* @__PURE__ */ fiberRefGet(currentLogAnnotations);
  mapAccum2 = /* @__PURE__ */ dual(3, (elements, initial, f) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let result = succeed(initial);
    let next;
    let i = 0;
    while (!(next = iterator.next()).done) {
      const index = i++;
      const value = next.value;
      result = flatMap7(result, (state) => map9(f(state, value, index), ([z, b]) => {
        builder.push(b);
        return z;
      }));
    }
    return map9(result, (z) => [z, builder]);
  }));
  mapErrorCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (c) => failCauseSync(() => f(c)),
    onSuccess: succeed
  }));
  orElseFail = /* @__PURE__ */ dual(2, (self, evaluate) => orElse2(self, () => failSync(evaluate)));
  orElseSucceed = /* @__PURE__ */ dual(2, (self, evaluate) => orElse2(self, () => sync(evaluate)));
  provideService = /* @__PURE__ */ dual(3, (self, tag, service) => contextWithEffect((env) => provideContext(self, add2(env, tag, service))));
  provideServiceEffect = /* @__PURE__ */ dual(3, (self, tag, effect) => contextWithEffect((env) => flatMap7(effect, (service) => provideContext(self, pipe(env, add2(tag, service))))));
  random2 = /* @__PURE__ */ randomWith(succeed);
  reduce9 = /* @__PURE__ */ dual(3, (elements, zero3, f) => fromIterable(elements).reduce((acc, el, i) => flatMap7(acc, (a) => f(a, el, i)), succeed(zero3)));
  reduceRight2 = /* @__PURE__ */ dual(3, (elements, zero3, f) => fromIterable(elements).reduceRight((acc, el, i) => flatMap7(acc, (a) => f(el, a, i)), succeed(zero3)));
  reduceWhile = /* @__PURE__ */ dual(3, (elements, zero3, options) => flatMap7(sync(() => elements[Symbol.iterator]()), (iterator) => reduceWhileLoop(iterator, 0, zero3, options.while, options.body)));
  repeatN = /* @__PURE__ */ dual(2, (self, n) => suspend(() => repeatNLoop(self, n)));
  sleep3 = sleep2;
  succeedNone = /* @__PURE__ */ succeed(/* @__PURE__ */ none2());
  summarized = /* @__PURE__ */ dual(3, (self, summary, f) => flatMap7(summary, (start) => flatMap7(self, (value) => map9(summary, (end) => [f(start, end), value]))));
  tagMetrics = /* @__PURE__ */ dual((args) => isEffect(args[0]), function() {
    return labelMetrics(arguments[0], typeof arguments[1] === "string" ? [make29(arguments[1], arguments[2])] : Object.entries(arguments[1]).map(([k, v]) => make29(k, v)));
  });
  labelMetrics = /* @__PURE__ */ dual(2, (self, labels) => fiberRefLocallyWith(self, currentMetricLabels, (old) => union(old, labels)));
  takeUntil = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let effect = succeed(false);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      effect = flatMap7(effect, (bool) => {
        if (bool) {
          return succeed(true);
        }
        builder.push(a);
        return predicate(a, index);
      });
    }
    return map9(effect, () => builder);
  }));
  takeWhile = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let taking = succeed(true);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      taking = flatMap7(taking, (taking2) => pipe(taking2 ? predicate(a, index) : succeed(false), map9((bool) => {
        if (bool) {
          builder.push(a);
        }
        return bool;
      })));
    }
    return map9(taking, () => builder);
  }));
  tapBoth = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => matchCauseEffect(self, {
    onFailure: (cause2) => {
      const either3 = failureOrCause(cause2);
      switch (either3._tag) {
        case "Left": {
          return zipRight(onFailure(either3.left), failCause(cause2));
        }
        case "Right": {
          return failCause(cause2);
        }
      }
    },
    onSuccess: (a) => as(onSuccess(a), a)
  }));
  tapDefect = /* @__PURE__ */ dual(2, (self, f) => catchAllCause(self, (cause2) => match2(keepDefects(cause2), {
    onNone: () => failCause(cause2),
    onSome: (a) => zipRight(f(a), failCause(cause2))
  })));
  tapError = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause2) => {
      const either3 = failureOrCause(cause2);
      switch (either3._tag) {
        case "Left":
          return zipRight(f(either3.left), failCause(cause2));
        case "Right":
          return failCause(cause2);
      }
    },
    onSuccess: succeed
  }));
  tapErrorTag = /* @__PURE__ */ dual(3, (self, k, f) => tapError(self, (e) => {
    if (isTagged(e, k)) {
      return f(e);
    }
    return void_;
  }));
  tapErrorCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause2) => zipRight(f(cause2), failCause(cause2)),
    onSuccess: succeed
  }));
  timedWith = /* @__PURE__ */ dual(2, (self, nanos2) => summarized(self, nanos2, (start, end) => nanos(end - start)));
  tracerWith3 = tracerWith2;
  tracer = /* @__PURE__ */ tracerWith3(succeed);
  tryMap = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => try_({
    try: () => options.try(a),
    catch: options.catch
  })));
  tryMapPromise = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => tryPromise({
    try: options.try.length >= 1 ? (signal) => options.try(a, signal) : () => options.try(a),
    catch: options.catch
  })));
  unless = /* @__PURE__ */ dual(2, (self, condition) => suspend(() => condition() ? succeedNone : asSome(self)));
  unlessEffect = /* @__PURE__ */ dual(2, (self, condition) => flatMap7(condition, (b) => b ? succeedNone : asSome(self)));
  updateService = /* @__PURE__ */ dual(3, (self, tag, f) => mapInputContext(self, (context2) => add2(context2, tag, f(unsafeGet3(context2, tag)))));
  when = /* @__PURE__ */ dual(2, (self, condition) => suspend(() => condition() ? map9(self, some2) : succeed(none2())));
  whenFiberRef = /* @__PURE__ */ dual(3, (self, fiberRef, predicate) => flatMap7(fiberRefGet(fiberRef), (s) => predicate(s) ? map9(self, (a) => [s, some2(a)]) : succeed([s, none2()])));
  whenRef = /* @__PURE__ */ dual(3, (self, ref, predicate) => flatMap7(get12(ref), (s) => predicate(s) ? map9(self, (a) => [s, some2(a)]) : succeed([s, none2()])));
  withMetric = /* @__PURE__ */ dual(2, (self, metric) => metric(self));
  annotateSpans = /* @__PURE__ */ dual((args) => isEffect(args[0]), function() {
    const args = arguments;
    return fiberRefLocallyWith(args[0], currentTracerSpanAnnotations, typeof args[1] === "string" ? set3(args[1], args[2]) : (annotations2) => Object.entries(args[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations2));
  });
  currentParentSpan = /* @__PURE__ */ serviceOptional(spanTag);
  currentSpan = /* @__PURE__ */ flatMap7(/* @__PURE__ */ context(), (context2) => {
    const span2 = context2.unsafeMap.get(spanTag.key);
    return span2 !== undefined && span2._tag === "Span" ? succeed(span2) : fail2(new NoSuchElementException);
  });
  linkSpans = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, span2, attributes) => fiberRefLocallyWith(self, currentTracerSpanLinks, append2({
    _tag: "SpanLink",
    span: span2,
    attributes: attributes ?? {}
  })));
  bigint03 = /* @__PURE__ */ BigInt(0);
  filterDisablePropagation = /* @__PURE__ */ flatMap((span2) => get3(span2.context, DisablePropagation) ? span2._tag === "Span" ? filterDisablePropagation(span2.parent) : none2() : some2(span2));
  spanAnnotations = /* @__PURE__ */ fiberRefGet(currentTracerSpanAnnotations);
  spanLinks = /* @__PURE__ */ fiberRefGet(currentTracerSpanLinks);
  withParentSpan = /* @__PURE__ */ dual(2, (self, span2) => provideService(self, spanTag, span2));
});

// node_modules/effect/dist/esm/internal/executionStrategy.js
var OP_SEQUENTIAL2 = "Sequential", OP_PARALLEL2 = "Parallel", OP_PARALLEL_N = "ParallelN", sequential2, parallel2, parallelN = (parallelism) => ({
  _tag: OP_PARALLEL_N,
  parallelism
}), isSequential = (self) => self._tag === OP_SEQUENTIAL2, isParallel = (self) => self._tag === OP_PARALLEL2;
var init_executionStrategy = __esm(() => {
  init_Function();
  sequential2 = {
    _tag: OP_SEQUENTIAL2
  };
  parallel2 = {
    _tag: OP_PARALLEL2
  };
});

// node_modules/effect/dist/esm/ExecutionStrategy.js
var sequential3, parallel3, parallelN2;
var init_ExecutionStrategy = __esm(() => {
  init_executionStrategy();
  sequential3 = sequential2;
  parallel3 = parallel2;
  parallelN2 = parallelN;
});

// node_modules/effect/dist/esm/FiberRefsPatch.js
var diff9, patch10;
var init_FiberRefsPatch = __esm(() => {
  init_patch();
  diff9 = diff8;
  patch10 = patch9;
});

// node_modules/effect/dist/esm/internal/fiberStatus.js
var FiberStatusSymbolKey = "effect/FiberStatus", FiberStatusTypeId, OP_DONE = "Done", OP_RUNNING = "Running", OP_SUSPENDED = "Suspended", DoneHash, Done, Running, Suspended, done3, running = (runtimeFlags2) => new Running(runtimeFlags2), suspended = (runtimeFlags2, blockingOn) => new Suspended(runtimeFlags2, blockingOn), isFiberStatus = (u) => hasProperty(u, FiberStatusTypeId), isDone = (self) => self._tag === OP_DONE;
var init_fiberStatus = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Predicate();
  FiberStatusTypeId = /* @__PURE__ */ Symbol.for(FiberStatusSymbolKey);
  DoneHash = /* @__PURE__ */ string(`${FiberStatusSymbolKey}-${OP_DONE}`);
  Done = class Done {
    [FiberStatusTypeId] = FiberStatusTypeId;
    _tag = OP_DONE;
    [symbol]() {
      return DoneHash;
    }
    [symbol2](that) {
      return isFiberStatus(that) && that._tag === OP_DONE;
    }
  };
  Running = class Running {
    runtimeFlags;
    [FiberStatusTypeId] = FiberStatusTypeId;
    _tag = OP_RUNNING;
    constructor(runtimeFlags2) {
      this.runtimeFlags = runtimeFlags2;
    }
    [symbol]() {
      return pipe(hash(FiberStatusSymbolKey), combine(hash(this._tag)), combine(hash(this.runtimeFlags)), cached(this));
    }
    [symbol2](that) {
      return isFiberStatus(that) && that._tag === OP_RUNNING && this.runtimeFlags === that.runtimeFlags;
    }
  };
  Suspended = class Suspended {
    runtimeFlags;
    blockingOn;
    [FiberStatusTypeId] = FiberStatusTypeId;
    _tag = OP_SUSPENDED;
    constructor(runtimeFlags2, blockingOn) {
      this.runtimeFlags = runtimeFlags2;
      this.blockingOn = blockingOn;
    }
    [symbol]() {
      return pipe(hash(FiberStatusSymbolKey), combine(hash(this._tag)), combine(hash(this.runtimeFlags)), combine(hash(this.blockingOn)), cached(this));
    }
    [symbol2](that) {
      return isFiberStatus(that) && that._tag === OP_SUSPENDED && this.runtimeFlags === that.runtimeFlags && equals(this.blockingOn, that.blockingOn);
    }
  };
  done3 = /* @__PURE__ */ new Done;
});

// node_modules/effect/dist/esm/FiberStatus.js
var done4, running2, suspended2, isDone2;
var init_FiberStatus = __esm(() => {
  init_fiberStatus();
  done4 = done3;
  running2 = running;
  suspended2 = suspended;
  isDone2 = isDone;
});

// node_modules/effect/dist/esm/Micro.js
function defaultEvaluate(_fiber) {
  return exitDie2(`Micro.evaluate: Not implemented`);
}

class MicroSchedulerDefault {
  tasks = [];
  running = false;
  scheduleTask(task, _priority) {
    this.tasks.push(task);
    if (!this.running) {
      this.running = true;
      setImmediate2(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = false;
    this.runTasks();
  };
  runTasks() {
    const tasks = this.tasks;
    this.tasks = [];
    for (let i = 0, len = tasks.length;i < len; i++) {
      tasks[i]();
    }
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.getRef(MaxOpsBeforeYield);
  }
  flush() {
    while (this.tasks.length > 0) {
      this.runTasks();
    }
  }
}
var TypeId14, MicroExitTypeId, MicroCauseTypeId, microCauseVariance, MicroCauseImpl, Die, causeDie = (defect, traces = []) => new Die(defect, traces), Interrupt, causeInterrupt = (traces = []) => new Interrupt(traces), causeIsInterrupt = (self) => self._tag === "Interrupt", MicroFiberTypeId, fiberVariance, MicroFiberImpl, fiberMiddleware, identifier, args, evaluate, successCont, failureCont, ensureCont, Yield, microVariance, MicroProto, makePrimitiveProto = (options) => ({
  ...MicroProto,
  [identifier]: options.op,
  [evaluate]: options.eval ?? defaultEvaluate,
  [successCont]: options.contA,
  [failureCont]: options.contE,
  [ensureCont]: options.ensure
}), makePrimitive = (options) => {
  const Proto2 = makePrimitiveProto(options);
  return function() {
    const self = Object.create(Proto2);
    self[args] = options.single === false ? arguments : arguments[0];
    return self;
  };
}, makeExit = (options) => {
  const Proto2 = {
    ...makePrimitiveProto(options),
    [MicroExitTypeId]: MicroExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    toJSON() {
      return {
        _id: "MicroExit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isMicroExit(that) && that._tag === options.op && equals(this[args], that[args]);
    },
    [symbol]() {
      return cached(this, combine(string(options.op))(hash(this[args])));
    }
  };
  return function(value) {
    const self = Object.create(Proto2);
    self[args] = value;
    self[successCont] = undefined;
    self[failureCont] = undefined;
    self[ensureCont] = undefined;
    return self;
  };
}, succeed3, failCause3, yieldNowWith, yieldNow2, void_2, withMicroFiber, flatMap8, OnSuccessProto, isMicroExit = (u) => hasProperty(u, MicroExitTypeId), exitSucceed2, exitFailCause2, exitInterrupt2, exitDie2 = (defect) => exitFailCause2(causeDie(defect)), exitVoid2, setImmediate2, updateContext, provideContext2, MaxOpsBeforeYield, CurrentScheduler, matchCauseEffect2, OnSuccessAndFailureProto, onExit2, setInterruptible, interruptible3 = (self) => withMicroFiber((fiber) => {
  if (fiber.interruptible)
    return self;
  fiber.interruptible = true;
  fiber._stack.push(setInterruptible(false));
  if (fiber._interrupted)
    return exitInterrupt2;
  return self;
}), uninterruptibleMask2 = (f) => withMicroFiber((fiber) => {
  if (!fiber.interruptible)
    return f(identity);
  fiber.interruptible = false;
  fiber._stack.push(setInterruptible(true));
  return f(interruptible3);
}), runFork = (effect, options) => {
  const fiber = new MicroFiberImpl(CurrentScheduler.context(options?.scheduler ?? new MicroSchedulerDefault));
  fiber.evaluate(effect);
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.unsafeInterrupt();
    } else {
      const abort = () => fiber.unsafeInterrupt();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  return fiber;
};
var init_Micro = __esm(() => {
  init_Array();
  init_Context();
  init_Effectable();
  init_Either();
  init_Equal();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_Inspectable();
  init_context();
  init_doNotation();
  init_effectable();
  init_Option();
  init_Predicate();
  init_Utils();
  TypeId14 = /* @__PURE__ */ Symbol.for("effect/Micro");
  MicroExitTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroExit");
  MicroCauseTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroCause");
  microCauseVariance = {
    _E: identity
  };
  MicroCauseImpl = class MicroCauseImpl extends globalThis.Error {
    _tag;
    traces;
    [MicroCauseTypeId];
    constructor(_tag, originalError, traces) {
      const causeName = `MicroCause.${_tag}`;
      let name;
      let message;
      let stack;
      if (originalError instanceof globalThis.Error) {
        name = `(${causeName}) ${originalError.name}`;
        message = originalError.message;
        const messageLines = message.split(`
`).length;
        stack = originalError.stack ? `(${causeName}) ${originalError.stack.split(`
`).slice(0, messageLines + 3).join(`
`)}` : `${name}: ${message}`;
      } else {
        name = causeName;
        message = toStringUnknown(originalError, 0);
        stack = `${name}: ${message}`;
      }
      if (traces.length > 0) {
        stack += `
    ${traces.join(`
    `)}`;
      }
      super(message);
      this._tag = _tag;
      this.traces = traces;
      this[MicroCauseTypeId] = microCauseVariance;
      this.name = name;
      this.stack = stack;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toString() {
      return this.stack;
    }
    [NodeInspectSymbol]() {
      return this.stack;
    }
  };
  Die = class Die extends MicroCauseImpl {
    defect;
    constructor(defect, traces = []) {
      super("Die", defect, traces);
      this.defect = defect;
    }
  };
  Interrupt = class Interrupt extends MicroCauseImpl {
    constructor(traces = []) {
      super("Interrupt", "interrupted", traces);
    }
  };
  MicroFiberTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroFiber");
  fiberVariance = {
    _A: identity,
    _E: identity
  };
  MicroFiberImpl = class MicroFiberImpl {
    context;
    interruptible;
    [MicroFiberTypeId];
    _stack = [];
    _observers = [];
    _exit;
    _children;
    currentOpCount = 0;
    constructor(context2, interruptible3 = true) {
      this.context = context2;
      this.interruptible = interruptible3;
      this[MicroFiberTypeId] = fiberVariance;
    }
    getRef(ref) {
      return unsafeGetReference(this.context, ref);
    }
    addObserver(cb) {
      if (this._exit) {
        cb(this._exit);
        return constVoid;
      }
      this._observers.push(cb);
      return () => {
        const index = this._observers.indexOf(cb);
        if (index >= 0) {
          this._observers.splice(index, 1);
        }
      };
    }
    _interrupted = false;
    unsafeInterrupt() {
      if (this._exit) {
        return;
      }
      this._interrupted = true;
      if (this.interruptible) {
        this.evaluate(exitInterrupt2);
      }
    }
    unsafePoll() {
      return this._exit;
    }
    evaluate(effect) {
      if (this._exit) {
        return;
      } else if (this._yielded !== undefined) {
        const yielded = this._yielded;
        this._yielded = undefined;
        yielded();
      }
      const exit2 = this.runLoop(effect);
      if (exit2 === Yield) {
        return;
      }
      const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
      if (interruptChildren !== undefined) {
        return this.evaluate(flatMap8(interruptChildren, () => exit2));
      }
      this._exit = exit2;
      for (let i = 0;i < this._observers.length; i++) {
        this._observers[i](exit2);
      }
      this._observers.length = 0;
    }
    runLoop(effect) {
      let yielding = false;
      let current = effect;
      this.currentOpCount = 0;
      try {
        while (true) {
          this.currentOpCount++;
          if (!yielding && this.getRef(CurrentScheduler).shouldYield(this)) {
            yielding = true;
            const prev = current;
            current = flatMap8(yieldNow2, () => prev);
          }
          current = current[evaluate](this);
          if (current === Yield) {
            const yielded = this._yielded;
            if (MicroExitTypeId in yielded) {
              this._yielded = undefined;
              return yielded;
            }
            return Yield;
          }
        }
      } catch (error) {
        if (!hasProperty(current, evaluate)) {
          return exitDie2(`MicroFiber.runLoop: Not a valid effect: ${String(current)}`);
        }
        return exitDie2(error);
      }
    }
    getCont(symbol3) {
      while (true) {
        const op = this._stack.pop();
        if (!op)
          return;
        const cont = op[ensureCont] && op[ensureCont](this);
        if (cont)
          return {
            [symbol3]: cont
          };
        if (op[symbol3])
          return op;
      }
    }
    _yielded = undefined;
    yieldWith(value) {
      this._yielded = value;
      return Yield;
    }
    children() {
      return this._children ??= new Set;
    }
  };
  fiberMiddleware = /* @__PURE__ */ globalValue("effect/Micro/fiberMiddleware", () => ({
    interruptChildren: undefined
  }));
  identifier = /* @__PURE__ */ Symbol.for("effect/Micro/identifier");
  args = /* @__PURE__ */ Symbol.for("effect/Micro/args");
  evaluate = /* @__PURE__ */ Symbol.for("effect/Micro/evaluate");
  successCont = /* @__PURE__ */ Symbol.for("effect/Micro/successCont");
  failureCont = /* @__PURE__ */ Symbol.for("effect/Micro/failureCont");
  ensureCont = /* @__PURE__ */ Symbol.for("effect/Micro/ensureCont");
  Yield = /* @__PURE__ */ Symbol.for("effect/Micro/Yield");
  microVariance = {
    _A: identity,
    _E: identity,
    _R: identity
  };
  MicroProto = {
    ...EffectPrototype2,
    _op: "Micro",
    [TypeId14]: microVariance,
    pipe() {
      return pipeArguments(this, arguments);
    },
    [Symbol.iterator]() {
      return new SingleShotGen(new YieldWrap(this));
    },
    toJSON() {
      return {
        _id: "Micro",
        op: this[identifier],
        ...args in this ? {
          args: this[args]
        } : undefined
      };
    },
    toString() {
      return format(this);
    },
    [NodeInspectSymbol]() {
      return format(this);
    }
  };
  succeed3 = /* @__PURE__ */ makeExit({
    op: "Success",
    prop: "value",
    eval(fiber) {
      const cont = fiber.getCont(successCont);
      return cont ? cont[successCont](this[args], fiber) : fiber.yieldWith(this);
    }
  });
  failCause3 = /* @__PURE__ */ makeExit({
    op: "Failure",
    prop: "cause",
    eval(fiber) {
      let cont = fiber.getCont(failureCont);
      while (causeIsInterrupt(this[args]) && cont && fiber.interruptible) {
        cont = fiber.getCont(failureCont);
      }
      return cont ? cont[failureCont](this[args], fiber) : fiber.yieldWith(this);
    }
  });
  yieldNowWith = /* @__PURE__ */ makePrimitive({
    op: "Yield",
    eval(fiber) {
      let resumed = false;
      fiber.getRef(CurrentScheduler).scheduleTask(() => {
        if (resumed)
          return;
        fiber.evaluate(exitVoid2);
      }, this[args] ?? 0);
      return fiber.yieldWith(() => {
        resumed = true;
      });
    }
  });
  yieldNow2 = /* @__PURE__ */ yieldNowWith(0);
  void_2 = /* @__PURE__ */ succeed3(undefined);
  withMicroFiber = /* @__PURE__ */ makePrimitive({
    op: "WithMicroFiber",
    eval(fiber) {
      return this[args](fiber);
    }
  });
  flatMap8 = /* @__PURE__ */ dual(2, (self, f) => {
    const onSuccess = Object.create(OnSuccessProto);
    onSuccess[args] = self;
    onSuccess[successCont] = f;
    return onSuccess;
  });
  OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnSuccess",
    eval(fiber) {
      fiber._stack.push(this);
      return this[args];
    }
  });
  exitSucceed2 = succeed3;
  exitFailCause2 = failCause3;
  exitInterrupt2 = /* @__PURE__ */ exitFailCause2(/* @__PURE__ */ causeInterrupt());
  exitVoid2 = /* @__PURE__ */ exitSucceed2(undefined);
  setImmediate2 = "setImmediate" in globalThis ? globalThis.setImmediate : (f) => setTimeout(f, 0);
  updateContext = /* @__PURE__ */ dual(2, (self, f) => withMicroFiber((fiber) => {
    const prev = fiber.context;
    fiber.context = f(prev);
    return onExit2(self, () => {
      fiber.context = prev;
      return void_2;
    });
  }));
  provideContext2 = /* @__PURE__ */ dual(2, (self, provided) => updateContext(self, merge3(provided)));
  MaxOpsBeforeYield = class MaxOpsBeforeYield extends (/* @__PURE__ */ Reference2()("effect/Micro/currentMaxOpsBeforeYield", {
    defaultValue: () => 2048
  })) {
  };
  CurrentScheduler = class CurrentScheduler extends (/* @__PURE__ */ Reference2()("effect/Micro/currentScheduler", {
    defaultValue: () => new MicroSchedulerDefault
  })) {
  };
  matchCauseEffect2 = /* @__PURE__ */ dual(2, (self, options) => {
    const primitive = Object.create(OnSuccessAndFailureProto);
    primitive[args] = self;
    primitive[successCont] = options.onSuccess;
    primitive[failureCont] = options.onFailure;
    return primitive;
  });
  OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnSuccessAndFailure",
    eval(fiber) {
      fiber._stack.push(this);
      return this[args];
    }
  });
  onExit2 = /* @__PURE__ */ dual(2, (self, f) => uninterruptibleMask2((restore) => matchCauseEffect2(restore(self), {
    onFailure: (cause2) => flatMap8(f(exitFailCause2(cause2)), () => failCause3(cause2)),
    onSuccess: (a) => flatMap8(f(exitSucceed2(a)), () => succeed3(a))
  })));
  setInterruptible = /* @__PURE__ */ makePrimitive({
    op: "SetInterruptible",
    ensure(fiber) {
      fiber.interruptible = this[args];
      if (fiber._interrupted && fiber.interruptible) {
        return () => exitInterrupt2;
      }
    }
  });
});

// node_modules/effect/dist/esm/Scheduler.js
class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const length2 = this.buckets.length;
    let bucket = undefined;
    let index = 0;
    for (;index < length2; index++) {
      if (this.buckets[index][0] <= priority) {
        bucket = this.buckets[index];
      } else {
        break;
      }
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === length2) {
      this.buckets.push([priority, [task]]);
    } else {
      this.buckets.splice(index, 0, [priority, [task]]);
    }
  }
}

class MixedScheduler {
  maxNextTickBeforeTimer;
  running = false;
  tasks = /* @__PURE__ */ new PriorityBuckets;
  constructor(maxNextTickBeforeTimer) {
    this.maxNextTickBeforeTimer = maxNextTickBeforeTimer;
  }
  starveInternal(depth) {
    const tasks = this.tasks.buckets;
    this.tasks.buckets = [];
    for (const [_, toRun] of tasks) {
      for (let i = 0;i < toRun.length; i++) {
        toRun[i]();
      }
    }
    if (this.tasks.buckets.length === 0) {
      this.running = false;
    } else {
      this.starve(depth);
    }
  }
  starve(depth = 0) {
    if (depth >= this.maxNextTickBeforeTimer) {
      setTimeout(() => this.starveInternal(0), 0);
    } else {
      Promise.resolve(undefined).then(() => this.starveInternal(depth + 1));
    }
  }
  shouldYield(fiber) {
    return fiber.currentOpCount > fiber.getFiberRef(currentMaxOpsBeforeYield) ? fiber.getFiberRef(currentSchedulingPriority) : false;
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (!this.running) {
      this.running = true;
      this.starve();
    }
  }
}

class SyncScheduler {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  deferred = false;
  scheduleTask(task, priority) {
    if (this.deferred) {
      defaultScheduler.scheduleTask(task, priority);
    } else {
      this.tasks.scheduleTask(task, priority);
    }
  }
  shouldYield(fiber) {
    return fiber.currentOpCount > fiber.getFiberRef(currentMaxOpsBeforeYield) ? fiber.getFiberRef(currentSchedulingPriority) : false;
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      const tasks = this.tasks.buckets;
      this.tasks.buckets = [];
      for (const [_, toRun] of tasks) {
        for (let i = 0;i < toRun.length; i++) {
          toRun[i]();
        }
      }
    }
    this.deferred = true;
  }
}
var defaultScheduler, currentScheduler, withScheduler;
var init_Scheduler = __esm(() => {
  init_Function();
  init_GlobalValue();
  init_core();
  defaultScheduler = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Scheduler/defaultScheduler"), () => new MixedScheduler(2048));
  currentScheduler = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentScheduler"), () => fiberRefUnsafeMake(defaultScheduler));
  withScheduler = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentScheduler, scheduler));
});

// node_modules/effect/dist/esm/internal/completedRequestMap.js
var currentRequestMap;
var init_completedRequestMap = __esm(() => {
  init_GlobalValue();
  init_core();
  currentRequestMap = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentRequestMap"), () => fiberRefUnsafeMake(new Map));
});

// node_modules/effect/dist/esm/internal/concurrency.js
var match8 = (concurrency, sequential4, unbounded2, bounded) => {
  switch (concurrency) {
    case undefined:
      return sequential4();
    case "unbounded":
      return unbounded2();
    case "inherit":
      return fiberRefGetWith(currentConcurrency, (concurrency2) => concurrency2 === "unbounded" ? unbounded2() : concurrency2 > 1 ? bounded(concurrency2) : sequential4());
    default:
      return concurrency > 1 ? bounded(concurrency) : sequential4();
  }
}, matchSimple = (concurrency, sequential4, concurrent) => {
  switch (concurrency) {
    case undefined:
      return sequential4();
    case "unbounded":
      return concurrent();
    case "inherit":
      return fiberRefGetWith(currentConcurrency, (concurrency2) => concurrency2 === "unbounded" || concurrency2 > 1 ? concurrent() : sequential4());
    default:
      return concurrency > 1 ? concurrent() : sequential4();
  }
};
var init_concurrency = __esm(() => {
  init_core();
});

// node_modules/effect/dist/esm/internal/fiberMessage.js
var OP_INTERRUPT_SIGNAL = "InterruptSignal", OP_STATEFUL = "Stateful", OP_RESUME = "Resume", OP_YIELD_NOW = "YieldNow", interruptSignal = (cause2) => ({
  _tag: OP_INTERRUPT_SIGNAL,
  cause: cause2
}), stateful = (onFiber) => ({
  _tag: OP_STATEFUL,
  onFiber
}), resume = (effect) => ({
  _tag: OP_RESUME,
  effect
}), yieldNow3 = () => ({
  _tag: OP_YIELD_NOW
});

// node_modules/effect/dist/esm/internal/fiberScope.js
var FiberScopeSymbolKey = "effect/FiberScope", FiberScopeTypeId, Global, Local, unsafeMake7 = (fiber) => {
  return new Local(fiber.id(), fiber);
}, globalScope;
var init_fiberScope = __esm(() => {
  init_FiberId();
  init_GlobalValue();
  FiberScopeTypeId = /* @__PURE__ */ Symbol.for(FiberScopeSymbolKey);
  Global = class Global {
    [FiberScopeTypeId] = FiberScopeTypeId;
    fiberId = none4;
    roots = /* @__PURE__ */ new Set;
    add(_runtimeFlags, child) {
      this.roots.add(child);
      child.addObserver(() => {
        this.roots.delete(child);
      });
    }
  };
  Local = class Local {
    fiberId;
    parent;
    [FiberScopeTypeId] = FiberScopeTypeId;
    constructor(fiberId2, parent) {
      this.fiberId = fiberId2;
      this.parent = parent;
    }
    add(_runtimeFlags, child) {
      this.parent.tell(stateful((parentFiber) => {
        parentFiber.addChild(child);
        child.addObserver(() => {
          parentFiber.removeChild(child);
        });
      }));
    }
  };
  globalScope = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberScope/Global"), () => new Global);
});

// node_modules/effect/dist/esm/internal/fiber.js
var FiberSymbolKey = "effect/Fiber", FiberTypeId, fiberVariance2, fiberProto, RuntimeFiberSymbolKey = "effect/Fiber", RuntimeFiberTypeId, _await2 = (self) => self.await, inheritAll = (self) => self.inheritAll, interruptAsFork, join2 = (self) => zipLeft(flatten5(self.await), self.inheritAll), _never, currentFiberURI = "effect/FiberCurrent";
var init_fiber = __esm(() => {
  init_Clock();
  init_Either();
  init_Exit();
  init_FiberId();
  init_FiberStatus();
  init_Function();
  init_HashSet();
  init_Number();
  init_Option();
  init_Order();
  init_Predicate();
  init_core();
  init_effectable();
  init_fiberScope();
  init_runtimeFlags();
  FiberTypeId = /* @__PURE__ */ Symbol.for(FiberSymbolKey);
  fiberVariance2 = {
    _E: (_) => _,
    _A: (_) => _
  };
  fiberProto = {
    [FiberTypeId]: fiberVariance2,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  RuntimeFiberTypeId = /* @__PURE__ */ Symbol.for(RuntimeFiberSymbolKey);
  interruptAsFork = /* @__PURE__ */ dual(2, (self, fiberId2) => self.interruptAsFork(fiberId2));
  _never = {
    ...CommitPrototype,
    commit() {
      return join2(this);
    },
    ...fiberProto,
    id: () => none4,
    await: never,
    children: /* @__PURE__ */ succeed([]),
    inheritAll: never,
    poll: /* @__PURE__ */ succeed(/* @__PURE__ */ none2()),
    interruptAsFork: () => never
  };
});

// node_modules/effect/dist/esm/internal/logger.js
var LoggerSymbolKey = "effect/Logger", LoggerTypeId, loggerVariance, makeLogger = (log2) => ({
  [LoggerTypeId]: loggerVariance,
  log: log2,
  pipe() {
    return pipeArguments(this, arguments);
  }
}), none7, textOnly, format4 = (quoteValue, whitespace) => ({
  annotations: annotations2,
  cause: cause2,
  date,
  fiberId: fiberId2,
  logLevel,
  message,
  spans
}) => {
  const formatValue = (value) => value.match(textOnly) ? value : quoteValue(value);
  const format5 = (label, value) => `${formatLabel(label)}=${formatValue(value)}`;
  const append4 = (label, value) => " " + format5(label, value);
  let out = format5("timestamp", date.toISOString());
  out += append4("level", logLevel.label);
  out += append4("fiber", threadName(fiberId2));
  const messages = ensure(message);
  for (let i = 0;i < messages.length; i++) {
    out += append4("message", toStringUnknown(messages[i], whitespace));
  }
  if (!isEmptyType(cause2)) {
    out += append4("cause", pretty(cause2, {
      renderErrorCause: true
    }));
  }
  for (const span2 of spans) {
    out += " " + render(date.getTime())(span2);
  }
  for (const [label, value] of annotations2) {
    out += append4(label, toStringUnknown(value, whitespace));
  }
  return out;
}, escapeDoubleQuotes = (s) => `"${s.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`, stringLogger, logfmtLogger, colors, logLevelColors, hasProcessStdout, processStdoutIsTTY, hasProcessStdoutOrDeno;
var init_logger = __esm(() => {
  init_Array();
  init_Context();
  init_FiberRefs();
  init_Function();
  init_GlobalValue();
  init_HashMap();
  init_Inspectable();
  init_List();
  init_Option();
  init_cause();
  init_defaultServices();
  init_console();
  init_fiberId();
  LoggerTypeId = /* @__PURE__ */ Symbol.for(LoggerSymbolKey);
  loggerVariance = {
    _Message: (_) => _,
    _Output: (_) => _
  };
  none7 = {
    [LoggerTypeId]: loggerVariance,
    log: constVoid,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  textOnly = /^[^\s"=]*$/;
  stringLogger = /* @__PURE__ */ makeLogger(/* @__PURE__ */ format4(escapeDoubleQuotes));
  logfmtLogger = /* @__PURE__ */ makeLogger(/* @__PURE__ */ format4(JSON.stringify, 0));
  colors = {
    bold: "1",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    cyan: "36",
    white: "37",
    gray: "90",
    black: "30",
    bgBrightRed: "101"
  };
  logLevelColors = {
    None: [],
    All: [],
    Trace: [colors.gray],
    Debug: [colors.blue],
    Info: [colors.green],
    Warning: [colors.yellow],
    Error: [colors.red],
    Fatal: [colors.bgBrightRed, colors.black]
  };
  hasProcessStdout = typeof process === "object" && process !== null && typeof process.stdout === "object" && process.stdout !== null;
  processStdoutIsTTY = hasProcessStdout && process.stdout.isTTY === true;
  hasProcessStdoutOrDeno = hasProcessStdout || "Deno" in globalThis;
});

// node_modules/effect/dist/esm/internal/metric/boundaries.js
var MetricBoundariesSymbolKey = "effect/MetricBoundaries", MetricBoundariesTypeId, MetricBoundariesImpl, isMetricBoundaries = (u) => hasProperty(u, MetricBoundariesTypeId), fromIterable7 = (iterable) => {
  const values3 = pipe(iterable, appendAll(of2(Number.POSITIVE_INFINITY)), dedupe);
  return new MetricBoundariesImpl(values3);
}, exponential = (options) => pipe(makeBy(options.count - 1, (i) => options.start * Math.pow(options.factor, i)), unsafeFromArray, fromIterable7);
var init_boundaries = __esm(() => {
  init_Array();
  init_Chunk();
  init_Equal();
  init_Function();
  init_Hash();
  init_Predicate();
  MetricBoundariesTypeId = /* @__PURE__ */ Symbol.for(MetricBoundariesSymbolKey);
  MetricBoundariesImpl = class MetricBoundariesImpl {
    values;
    [MetricBoundariesTypeId] = MetricBoundariesTypeId;
    constructor(values3) {
      this.values = values3;
      this._hash = pipe(string(MetricBoundariesSymbolKey), combine(array2(this.values)));
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](u) {
      return isMetricBoundaries(u) && equals(this.values, u.values);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/metric/keyType.js
var MetricKeyTypeSymbolKey = "effect/MetricKeyType", MetricKeyTypeTypeId, CounterKeyTypeSymbolKey = "effect/MetricKeyType/Counter", CounterKeyTypeTypeId, FrequencyKeyTypeSymbolKey = "effect/MetricKeyType/Frequency", FrequencyKeyTypeTypeId, GaugeKeyTypeSymbolKey = "effect/MetricKeyType/Gauge", GaugeKeyTypeTypeId, HistogramKeyTypeSymbolKey = "effect/MetricKeyType/Histogram", HistogramKeyTypeTypeId, SummaryKeyTypeSymbolKey = "effect/MetricKeyType/Summary", SummaryKeyTypeTypeId, metricKeyTypeVariance, CounterKeyType, HistogramKeyType, counter = (options) => new CounterKeyType(options?.incremental ?? false, options?.bigint ?? false), histogram = (boundaries) => {
  return new HistogramKeyType(boundaries);
}, isCounterKey = (u) => hasProperty(u, CounterKeyTypeTypeId), isFrequencyKey = (u) => hasProperty(u, FrequencyKeyTypeTypeId), isGaugeKey = (u) => hasProperty(u, GaugeKeyTypeTypeId), isHistogramKey = (u) => hasProperty(u, HistogramKeyTypeTypeId), isSummaryKey = (u) => hasProperty(u, SummaryKeyTypeTypeId);
var init_keyType = __esm(() => {
  init_Duration();
  init_Equal();
  init_Function();
  init_Hash();
  init_Predicate();
  MetricKeyTypeTypeId = /* @__PURE__ */ Symbol.for(MetricKeyTypeSymbolKey);
  CounterKeyTypeTypeId = /* @__PURE__ */ Symbol.for(CounterKeyTypeSymbolKey);
  FrequencyKeyTypeTypeId = /* @__PURE__ */ Symbol.for(FrequencyKeyTypeSymbolKey);
  GaugeKeyTypeTypeId = /* @__PURE__ */ Symbol.for(GaugeKeyTypeSymbolKey);
  HistogramKeyTypeTypeId = /* @__PURE__ */ Symbol.for(HistogramKeyTypeSymbolKey);
  SummaryKeyTypeTypeId = /* @__PURE__ */ Symbol.for(SummaryKeyTypeSymbolKey);
  metricKeyTypeVariance = {
    _In: (_) => _,
    _Out: (_) => _
  };
  CounterKeyType = class CounterKeyType {
    incremental;
    bigint;
    [MetricKeyTypeTypeId] = metricKeyTypeVariance;
    [CounterKeyTypeTypeId] = CounterKeyTypeTypeId;
    constructor(incremental, bigint3) {
      this.incremental = incremental;
      this.bigint = bigint3;
      this._hash = string(CounterKeyTypeSymbolKey);
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](that) {
      return isCounterKey(that);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  HistogramKeyType = class HistogramKeyType {
    boundaries;
    [MetricKeyTypeTypeId] = metricKeyTypeVariance;
    [HistogramKeyTypeTypeId] = HistogramKeyTypeTypeId;
    constructor(boundaries) {
      this.boundaries = boundaries;
      this._hash = pipe(string(HistogramKeyTypeSymbolKey), combine(hash(this.boundaries)));
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](that) {
      return isHistogramKey(that) && equals(this.boundaries, that.boundaries);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/metric/key.js
var MetricKeySymbolKey = "effect/MetricKey", MetricKeyTypeId, metricKeyVariance, arrayEquivilence, MetricKeyImpl, isMetricKey = (u) => hasProperty(u, MetricKeyTypeId), counter2 = (name, options) => new MetricKeyImpl(name, counter(options), fromNullable(options?.description)), histogram2 = (name, boundaries, description) => new MetricKeyImpl(name, histogram(boundaries), fromNullable(description)), taggedWithLabels;
var init_key = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_Hash();
  init_Option();
  init_Predicate();
  init_keyType();
  init_label();
  MetricKeyTypeId = /* @__PURE__ */ Symbol.for(MetricKeySymbolKey);
  metricKeyVariance = {
    _Type: (_) => _
  };
  arrayEquivilence = /* @__PURE__ */ getEquivalence(equals);
  MetricKeyImpl = class MetricKeyImpl {
    name;
    keyType;
    description;
    tags;
    [MetricKeyTypeId] = metricKeyVariance;
    constructor(name, keyType, description, tags = []) {
      this.name = name;
      this.keyType = keyType;
      this.description = description;
      this.tags = tags;
      this._hash = pipe(string(this.name + this.description), combine(hash(this.keyType)), combine(array2(this.tags)));
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](u) {
      return isMetricKey(u) && this.name === u.name && equals(this.keyType, u.keyType) && equals(this.description, u.description) && arrayEquivilence(this.tags, u.tags);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  taggedWithLabels = /* @__PURE__ */ dual(2, (self, extraTags) => extraTags.length === 0 ? self : new MetricKeyImpl(self.name, self.keyType, self.description, union(self.tags, extraTags)));
});

// node_modules/effect/dist/esm/internal/metric/state.js
var MetricStateSymbolKey = "effect/MetricState", MetricStateTypeId, CounterStateSymbolKey = "effect/MetricState/Counter", CounterStateTypeId, FrequencyStateSymbolKey = "effect/MetricState/Frequency", FrequencyStateTypeId, GaugeStateSymbolKey = "effect/MetricState/Gauge", GaugeStateTypeId, HistogramStateSymbolKey = "effect/MetricState/Histogram", HistogramStateTypeId, SummaryStateSymbolKey = "effect/MetricState/Summary", SummaryStateTypeId, metricStateVariance, CounterState, arrayEquals, FrequencyState, GaugeState, HistogramState, SummaryState, counter3 = (count) => new CounterState(count), frequency2 = (occurrences) => {
  return new FrequencyState(occurrences);
}, gauge2 = (count) => new GaugeState(count), histogram3 = (options) => new HistogramState(options.buckets, options.count, options.min, options.max, options.sum), summary2 = (options) => new SummaryState(options.error, options.quantiles, options.count, options.min, options.max, options.sum), isCounterState = (u) => hasProperty(u, CounterStateTypeId), isFrequencyState = (u) => hasProperty(u, FrequencyStateTypeId), isGaugeState = (u) => hasProperty(u, GaugeStateTypeId), isHistogramState = (u) => hasProperty(u, HistogramStateTypeId), isSummaryState = (u) => hasProperty(u, SummaryStateTypeId);
var init_state = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_Hash();
  init_Predicate();
  MetricStateTypeId = /* @__PURE__ */ Symbol.for(MetricStateSymbolKey);
  CounterStateTypeId = /* @__PURE__ */ Symbol.for(CounterStateSymbolKey);
  FrequencyStateTypeId = /* @__PURE__ */ Symbol.for(FrequencyStateSymbolKey);
  GaugeStateTypeId = /* @__PURE__ */ Symbol.for(GaugeStateSymbolKey);
  HistogramStateTypeId = /* @__PURE__ */ Symbol.for(HistogramStateSymbolKey);
  SummaryStateTypeId = /* @__PURE__ */ Symbol.for(SummaryStateSymbolKey);
  metricStateVariance = {
    _A: (_) => _
  };
  CounterState = class CounterState {
    count;
    [MetricStateTypeId] = metricStateVariance;
    [CounterStateTypeId] = CounterStateTypeId;
    constructor(count) {
      this.count = count;
    }
    [symbol]() {
      return pipe(hash(CounterStateSymbolKey), combine(hash(this.count)), cached(this));
    }
    [symbol2](that) {
      return isCounterState(that) && this.count === that.count;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  arrayEquals = /* @__PURE__ */ getEquivalence(equals);
  FrequencyState = class FrequencyState {
    occurrences;
    [MetricStateTypeId] = metricStateVariance;
    [FrequencyStateTypeId] = FrequencyStateTypeId;
    constructor(occurrences) {
      this.occurrences = occurrences;
    }
    _hash;
    [symbol]() {
      return pipe(string(FrequencyStateSymbolKey), combine(array2(fromIterable(this.occurrences.entries()))), cached(this));
    }
    [symbol2](that) {
      return isFrequencyState(that) && arrayEquals(fromIterable(this.occurrences.entries()), fromIterable(that.occurrences.entries()));
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  GaugeState = class GaugeState {
    value;
    [MetricStateTypeId] = metricStateVariance;
    [GaugeStateTypeId] = GaugeStateTypeId;
    constructor(value) {
      this.value = value;
    }
    [symbol]() {
      return pipe(hash(GaugeStateSymbolKey), combine(hash(this.value)), cached(this));
    }
    [symbol2](u) {
      return isGaugeState(u) && this.value === u.value;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  HistogramState = class HistogramState {
    buckets;
    count;
    min;
    max;
    sum;
    [MetricStateTypeId] = metricStateVariance;
    [HistogramStateTypeId] = HistogramStateTypeId;
    constructor(buckets, count, min2, max2, sum) {
      this.buckets = buckets;
      this.count = count;
      this.min = min2;
      this.max = max2;
      this.sum = sum;
    }
    [symbol]() {
      return pipe(hash(HistogramStateSymbolKey), combine(hash(this.buckets)), combine(hash(this.count)), combine(hash(this.min)), combine(hash(this.max)), combine(hash(this.sum)), cached(this));
    }
    [symbol2](that) {
      return isHistogramState(that) && equals(this.buckets, that.buckets) && this.count === that.count && this.min === that.min && this.max === that.max && this.sum === that.sum;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  SummaryState = class SummaryState {
    error;
    quantiles;
    count;
    min;
    max;
    sum;
    [MetricStateTypeId] = metricStateVariance;
    [SummaryStateTypeId] = SummaryStateTypeId;
    constructor(error, quantiles, count, min2, max2, sum) {
      this.error = error;
      this.quantiles = quantiles;
      this.count = count;
      this.min = min2;
      this.max = max2;
      this.sum = sum;
    }
    [symbol]() {
      return pipe(hash(SummaryStateSymbolKey), combine(hash(this.error)), combine(hash(this.quantiles)), combine(hash(this.count)), combine(hash(this.min)), combine(hash(this.max)), combine(hash(this.sum)), cached(this));
    }
    [symbol2](that) {
      return isSummaryState(that) && this.error === that.error && equals(this.quantiles, that.quantiles) && this.count === that.count && this.min === that.min && this.max === that.max && this.sum === that.sum;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/metric/hook.js
var MetricHookSymbolKey = "effect/MetricHook", MetricHookTypeId, metricHookVariance, make30 = (options) => ({
  [MetricHookTypeId]: metricHookVariance,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...options
}), bigint04, counter4 = (key) => {
  let sum = key.keyType.bigint ? bigint04 : 0;
  const canUpdate = key.keyType.incremental ? key.keyType.bigint ? (value) => value >= bigint04 : (value) => value >= 0 : (_value) => true;
  const update4 = (value) => {
    if (canUpdate(value)) {
      sum = sum + value;
    }
  };
  return make30({
    get: () => counter3(sum),
    update: update4,
    modify: update4
  });
}, frequency3 = (key) => {
  const values3 = new Map;
  for (const word of key.keyType.preregisteredWords) {
    values3.set(word, 0);
  }
  const update4 = (word) => {
    const slotCount = values3.get(word) ?? 0;
    values3.set(word, slotCount + 1);
  };
  return make30({
    get: () => frequency2(values3),
    update: update4,
    modify: update4
  });
}, gauge3 = (_key, startAt) => {
  let value = startAt;
  return make30({
    get: () => gauge2(value),
    update: (v) => {
      value = v;
    },
    modify: (v) => {
      value = value + v;
    }
  });
}, histogram4 = (key) => {
  const bounds = key.keyType.boundaries.values;
  const size6 = bounds.length;
  const values3 = new Uint32Array(size6 + 1);
  const boundaries = new Float32Array(size6);
  let count = 0;
  let sum = 0;
  let min2 = Number.MAX_VALUE;
  let max2 = Number.MIN_VALUE;
  pipe(bounds, sort(Order), map3((n, i) => {
    boundaries[i] = n;
  }));
  const update4 = (value) => {
    let from = 0;
    let to = size6;
    while (from !== to) {
      const mid = Math.floor(from + (to - from) / 2);
      const boundary = boundaries[mid];
      if (value <= boundary) {
        to = mid;
      } else {
        from = mid;
      }
      if (to === from + 1) {
        if (value <= boundaries[from]) {
          to = from;
        } else {
          from = to;
        }
      }
    }
    values3[from] = values3[from] + 1;
    count = count + 1;
    sum = sum + value;
    if (value < min2) {
      min2 = value;
    }
    if (value > max2) {
      max2 = value;
    }
  };
  const getBuckets = () => {
    const builder = allocate(size6);
    let cumulated = 0;
    for (let i = 0;i < size6; i++) {
      const boundary = boundaries[i];
      const value = values3[i];
      cumulated = cumulated + value;
      builder[i] = [boundary, cumulated];
    }
    return builder;
  };
  return make30({
    get: () => histogram3({
      buckets: getBuckets(),
      count,
      min: min2,
      max: max2,
      sum
    }),
    update: update4,
    modify: update4
  });
}, summary3 = (key) => {
  const {
    error,
    maxAge,
    maxSize,
    quantiles
  } = key.keyType;
  const sortedQuantiles = pipe(quantiles, sort(Order));
  const values3 = allocate(maxSize);
  let head4 = 0;
  let count = 0;
  let sum = 0;
  let min2 = Number.MAX_VALUE;
  let max2 = Number.MIN_VALUE;
  const snapshot = (now) => {
    const builder = [];
    let i = 0;
    while (i !== maxSize - 1) {
      const item = values3[i];
      if (item != null) {
        const [t, v] = item;
        const age = millis(now - t);
        if (greaterThanOrEqualTo2(age, zero2) && age <= maxAge) {
          builder.push(v);
        }
      }
      i = i + 1;
    }
    return calculateQuantiles(error, sortedQuantiles, sort(builder, Order));
  };
  const observe = (value, timestamp) => {
    if (maxSize > 0) {
      head4 = head4 + 1;
      const target = head4 % maxSize;
      values3[target] = [timestamp, value];
    }
    count = count + 1;
    sum = sum + value;
    if (value < min2) {
      min2 = value;
    }
    if (value > max2) {
      max2 = value;
    }
  };
  return make30({
    get: () => summary2({
      error,
      quantiles: snapshot(Date.now()),
      count,
      min: min2,
      max: max2,
      sum
    }),
    update: ([value, timestamp]) => observe(value, timestamp),
    modify: ([value, timestamp]) => observe(value, timestamp)
  });
}, calculateQuantiles = (error, sortedQuantiles, sortedSamples) => {
  const sampleCount = sortedSamples.length;
  if (!isNonEmptyReadonlyArray(sortedQuantiles)) {
    return empty2();
  }
  const head4 = sortedQuantiles[0];
  const tail = sortedQuantiles.slice(1);
  const resolvedHead = resolveQuantile(error, sampleCount, none2(), 0, head4, sortedSamples);
  const resolved = of(resolvedHead);
  tail.forEach((quantile) => {
    resolved.push(resolveQuantile(error, sampleCount, resolvedHead.value, resolvedHead.consumed, quantile, resolvedHead.rest));
  });
  return map3(resolved, (rq) => [rq.quantile, rq.value]);
}, resolveQuantile = (error, sampleCount, current, consumed, quantile, rest) => {
  let error_1 = error;
  let sampleCount_1 = sampleCount;
  let current_1 = current;
  let consumed_1 = consumed;
  let quantile_1 = quantile;
  let rest_1 = rest;
  let error_2 = error;
  let sampleCount_2 = sampleCount;
  let current_2 = current;
  let consumed_2 = consumed;
  let quantile_2 = quantile;
  let rest_2 = rest;
  while (true) {
    if (!isNonEmptyReadonlyArray(rest_1)) {
      return {
        quantile: quantile_1,
        value: none2(),
        consumed: consumed_1,
        rest: []
      };
    }
    if (quantile_1 === 1) {
      return {
        quantile: quantile_1,
        value: some2(lastNonEmpty(rest_1)),
        consumed: consumed_1 + rest_1.length,
        rest: []
      };
    }
    const sameHead = span(rest_1, (n) => n <= rest_1[0]);
    const desired = quantile_1 * sampleCount_1;
    const allowedError = error_1 / 2 * desired;
    const candConsumed = consumed_1 + sameHead[0].length;
    const candError = Math.abs(candConsumed - desired);
    if (candConsumed < desired - allowedError) {
      error_2 = error_1;
      sampleCount_2 = sampleCount_1;
      current_2 = head(rest_1);
      consumed_2 = candConsumed;
      quantile_2 = quantile_1;
      rest_2 = sameHead[1];
      error_1 = error_2;
      sampleCount_1 = sampleCount_2;
      current_1 = current_2;
      consumed_1 = consumed_2;
      quantile_1 = quantile_2;
      rest_1 = rest_2;
      continue;
    }
    if (candConsumed > desired + allowedError) {
      return {
        quantile: quantile_1,
        value: current_1,
        consumed: consumed_1,
        rest: rest_1
      };
    }
    switch (current_1._tag) {
      case "None": {
        error_2 = error_1;
        sampleCount_2 = sampleCount_1;
        current_2 = head(rest_1);
        consumed_2 = candConsumed;
        quantile_2 = quantile_1;
        rest_2 = sameHead[1];
        error_1 = error_2;
        sampleCount_1 = sampleCount_2;
        current_1 = current_2;
        consumed_1 = consumed_2;
        quantile_1 = quantile_2;
        rest_1 = rest_2;
        continue;
      }
      case "Some": {
        const prevError = Math.abs(desired - current_1.value);
        if (candError < prevError) {
          error_2 = error_1;
          sampleCount_2 = sampleCount_1;
          current_2 = head(rest_1);
          consumed_2 = candConsumed;
          quantile_2 = quantile_1;
          rest_2 = sameHead[1];
          error_1 = error_2;
          sampleCount_1 = sampleCount_2;
          current_1 = current_2;
          consumed_1 = consumed_2;
          quantile_1 = quantile_2;
          rest_1 = rest_2;
          continue;
        }
        return {
          quantile: quantile_1,
          value: some2(current_1.value),
          consumed: consumed_1,
          rest: rest_1
        };
      }
    }
  }
  throw new Error("BUG: MetricHook.resolveQuantiles - please report an issue at https://github.com/Effect-TS/effect/issues");
};
var init_hook = __esm(() => {
  init_Array();
  init_Duration();
  init_Function();
  init_Number();
  init_Option();
  init_state();
  MetricHookTypeId = /* @__PURE__ */ Symbol.for(MetricHookSymbolKey);
  metricHookVariance = {
    _In: (_) => _,
    _Out: (_) => _
  };
  bigint04 = /* @__PURE__ */ BigInt(0);
});

// node_modules/effect/dist/esm/internal/metric/pair.js
var MetricPairSymbolKey = "effect/MetricPair", MetricPairTypeId, metricPairVariance, unsafeMake8 = (metricKey, metricState) => {
  return {
    [MetricPairTypeId]: metricPairVariance,
    metricKey,
    metricState,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
};
var init_pair = __esm(() => {
  MetricPairTypeId = /* @__PURE__ */ Symbol.for(MetricPairSymbolKey);
  metricPairVariance = {
    _Type: (_) => _
  };
});

// node_modules/effect/dist/esm/internal/metric/registry.js
var MetricRegistrySymbolKey = "effect/MetricRegistry", MetricRegistryTypeId, MetricRegistryImpl, make31 = () => {
  return new MetricRegistryImpl;
};
var init_registry = __esm(() => {
  init_Function();
  init_MutableHashMap();
  init_Option();
  init_hook();
  init_keyType();
  init_pair();
  MetricRegistryTypeId = /* @__PURE__ */ Symbol.for(MetricRegistrySymbolKey);
  MetricRegistryImpl = class MetricRegistryImpl {
    [MetricRegistryTypeId] = MetricRegistryTypeId;
    map = /* @__PURE__ */ empty21();
    snapshot() {
      const result = [];
      for (const [key, hook] of this.map) {
        result.push(unsafeMake8(key, hook.get()));
      }
      return result;
    }
    get(key) {
      const hook = pipe(this.map, get8(key), getOrUndefined);
      if (hook == null) {
        if (isCounterKey(key.keyType)) {
          return this.getCounter(key);
        }
        if (isGaugeKey(key.keyType)) {
          return this.getGauge(key);
        }
        if (isFrequencyKey(key.keyType)) {
          return this.getFrequency(key);
        }
        if (isHistogramKey(key.keyType)) {
          return this.getHistogram(key);
        }
        if (isSummaryKey(key.keyType)) {
          return this.getSummary(key);
        }
        throw new Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
      } else {
        return hook;
      }
    }
    getCounter(key) {
      let value = pipe(this.map, get8(key), getOrUndefined);
      if (value == null) {
        const counter5 = counter4(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set4(key, counter5));
        }
        value = counter5;
      }
      return value;
    }
    getFrequency(key) {
      let value = pipe(this.map, get8(key), getOrUndefined);
      if (value == null) {
        const frequency4 = frequency3(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set4(key, frequency4));
        }
        value = frequency4;
      }
      return value;
    }
    getGauge(key) {
      let value = pipe(this.map, get8(key), getOrUndefined);
      if (value == null) {
        const gauge4 = gauge3(key, key.keyType.bigint ? BigInt(0) : 0);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set4(key, gauge4));
        }
        value = gauge4;
      }
      return value;
    }
    getHistogram(key) {
      let value = pipe(this.map, get8(key), getOrUndefined);
      if (value == null) {
        const histogram5 = histogram4(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set4(key, histogram5));
        }
        value = histogram5;
      }
      return value;
    }
    getSummary(key) {
      let value = pipe(this.map, get8(key), getOrUndefined);
      if (value == null) {
        const summary4 = summary3(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set4(key, summary4));
        }
        value = summary4;
      }
      return value;
    }
  };
});

// node_modules/effect/dist/esm/internal/metric.js
var MetricSymbolKey = "effect/Metric", MetricTypeId, metricVariance, globalMetricRegistry, make32 = function(keyType, unsafeUpdate, unsafeValue, unsafeModify) {
  const metric = Object.assign((effect) => tap(effect, (a) => update4(metric, a)), {
    [MetricTypeId]: metricVariance,
    keyType,
    unsafeUpdate,
    unsafeValue,
    unsafeModify,
    register() {
      this.unsafeValue([]);
      return this;
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  });
  return metric;
}, counter5 = (name, options) => fromMetricKey(counter2(name, options)), fromMetricKey = (key) => {
  let untaggedHook;
  const hookCache = new WeakMap;
  const hook = (extraTags) => {
    if (extraTags.length === 0) {
      if (untaggedHook !== undefined) {
        return untaggedHook;
      }
      untaggedHook = globalMetricRegistry.get(key);
      return untaggedHook;
    }
    let hook2 = hookCache.get(extraTags);
    if (hook2 !== undefined) {
      return hook2;
    }
    hook2 = globalMetricRegistry.get(taggedWithLabels(key, extraTags));
    hookCache.set(extraTags, hook2);
    return hook2;
  };
  return make32(key.keyType, (input, extraTags) => hook(extraTags).update(input), (extraTags) => hook(extraTags).get(), (input, extraTags) => hook(extraTags).modify(input));
}, histogram5 = (name, boundaries, description) => fromMetricKey(histogram2(name, boundaries, description)), tagged, taggedWithLabels2, update4;
var init_metric = __esm(() => {
  init_Array();
  init_Clock();
  init_Duration();
  init_Function();
  init_GlobalValue();
  init_cause();
  init_core_effect();
  init_core();
  init_boundaries();
  init_key();
  init_keyType();
  init_label();
  init_registry();
  MetricTypeId = /* @__PURE__ */ Symbol.for(MetricSymbolKey);
  metricVariance = {
    _Type: (_) => _,
    _In: (_) => _,
    _Out: (_) => _
  };
  globalMetricRegistry = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Metric/globalMetricRegistry"), () => make31());
  tagged = /* @__PURE__ */ dual(3, (self, key, value) => taggedWithLabels2(self, [make29(key, value)]));
  taggedWithLabels2 = /* @__PURE__ */ dual(2, (self, extraTags) => {
    return make32(self.keyType, (input, extraTags1) => self.unsafeUpdate(input, union(extraTags, extraTags1)), (extraTags1) => self.unsafeValue(union(extraTags, extraTags1)), (input, extraTags1) => self.unsafeModify(input, union(extraTags, extraTags1)));
  });
  update4 = /* @__PURE__ */ dual(2, (self, input) => fiberRefGetWith(currentMetricLabels, (tags) => sync(() => self.unsafeUpdate(input, tags))));
});

// node_modules/effect/dist/esm/internal/request.js
class Listeners {
  count = 0;
  observers = /* @__PURE__ */ new Set;
  interrupted = false;
  addObserver(f) {
    this.observers.add(f);
  }
  removeObserver(f) {
    this.observers.delete(f);
  }
  increment() {
    this.count++;
    this.observers.forEach((f) => f(this.count));
  }
  decrement() {
    this.count--;
    this.observers.forEach((f) => f(this.count));
  }
}
var RequestSymbolKey = "effect/Request", RequestTypeId, requestVariance, RequestPrototype, isRequest = (u) => hasProperty(u, RequestTypeId), complete;
var init_request = __esm(() => {
  init_Function();
  init_Predicate();
  init_completedRequestMap();
  init_core();
  init_effectable();
  RequestTypeId = /* @__PURE__ */ Symbol.for(RequestSymbolKey);
  requestVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
  RequestPrototype = {
    ...StructuralPrototype,
    [RequestTypeId]: requestVariance
  };
  complete = /* @__PURE__ */ dual(2, (self, result) => fiberRefGetWith(currentRequestMap, (map10) => sync(() => {
    if (map10.has(self)) {
      const entry = map10.get(self);
      if (!entry.state.completed) {
        entry.state.completed = true;
        deferredUnsafeDone(entry.result, result);
      }
    }
  })));
});

// node_modules/effect/dist/esm/internal/redBlackTree/iterator.js
class RedBlackTreeIterator {
  self;
  stack;
  direction;
  count = 0;
  constructor(self, stack, direction) {
    this.self = self;
    this.stack = stack;
    this.direction = direction;
  }
  clone() {
    return new RedBlackTreeIterator(this.self, this.stack.slice(), this.direction);
  }
  reversed() {
    return new RedBlackTreeIterator(this.self, this.stack.slice(), this.direction === Direction.Forward ? Direction.Backward : Direction.Forward);
  }
  next() {
    const entry = this.entry;
    this.count++;
    if (this.direction === Direction.Forward) {
      this.moveNext();
    } else {
      this.movePrev();
    }
    switch (entry._tag) {
      case "None": {
        return {
          done: true,
          value: this.count
        };
      }
      case "Some": {
        return {
          done: false,
          value: entry.value
        };
      }
    }
  }
  get key() {
    if (this.stack.length > 0) {
      return some2(this.stack[this.stack.length - 1].key);
    }
    return none2();
  }
  get value() {
    if (this.stack.length > 0) {
      return some2(this.stack[this.stack.length - 1].value);
    }
    return none2();
  }
  get entry() {
    return map2(last(this.stack), (node) => [node.key, node.value]);
  }
  get index() {
    let idx = 0;
    const stack = this.stack;
    if (stack.length === 0) {
      const r = this.self._root;
      if (r != null) {
        return r.count;
      }
      return 0;
    } else if (stack[stack.length - 1].left != null) {
      idx = stack[stack.length - 1].left.count;
    }
    for (let s = stack.length - 2;s >= 0; --s) {
      if (stack[s + 1] === stack[s].right) {
        ++idx;
        if (stack[s].left != null) {
          idx += stack[s].left.count;
        }
      }
    }
    return idx;
  }
  moveNext() {
    const stack = this.stack;
    if (stack.length === 0) {
      return;
    }
    let n = stack[stack.length - 1];
    if (n.right != null) {
      n = n.right;
      while (n != null) {
        stack.push(n);
        n = n.left;
      }
    } else {
      stack.pop();
      while (stack.length > 0 && stack[stack.length - 1].right === n) {
        n = stack[stack.length - 1];
        stack.pop();
      }
    }
  }
  get hasNext() {
    const stack = this.stack;
    if (stack.length === 0) {
      return false;
    }
    if (stack[stack.length - 1].right != null) {
      return true;
    }
    for (let s = stack.length - 1;s > 0; --s) {
      if (stack[s - 1].left === stack[s]) {
        return true;
      }
    }
    return false;
  }
  movePrev() {
    const stack = this.stack;
    if (stack.length === 0) {
      return;
    }
    let n = stack[stack.length - 1];
    if (n != null && n.left != null) {
      n = n.left;
      while (n != null) {
        stack.push(n);
        n = n.right;
      }
    } else {
      stack.pop();
      while (stack.length > 0 && stack[stack.length - 1].left === n) {
        n = stack[stack.length - 1];
        stack.pop();
      }
    }
  }
  get hasPrev() {
    const stack = this.stack;
    if (stack.length === 0) {
      return false;
    }
    if (stack[stack.length - 1].left != null) {
      return true;
    }
    for (let s = stack.length - 1;s > 0; --s) {
      if (stack[s - 1].right === stack[s]) {
        return true;
      }
    }
    return false;
  }
}
var Direction;
var init_iterator = __esm(() => {
  init_Array();
  init_Option();
  Direction = {
    Forward: 0,
    Backward: 1 << 0
  };
});

// node_modules/effect/dist/esm/internal/redBlackTree/node.js
var Color;
var init_node2 = __esm(() => {
  Color = {
    Red: 0,
    Black: 1 << 0
  };
});

// node_modules/effect/dist/esm/internal/redBlackTree.js
var RedBlackTreeSymbolKey = "effect/RedBlackTree", RedBlackTreeTypeId, redBlackTreeVariance, RedBlackTreeProto, isRedBlackTree = (u) => hasProperty(u, RedBlackTreeTypeId), keysForward = (self) => keys3(self, Direction.Forward), keys3 = (self, direction) => {
  const begin = self[Symbol.iterator]();
  let count = 0;
  return {
    [Symbol.iterator]: () => keys3(self, direction),
    next: () => {
      count++;
      const entry = begin.key;
      if (direction === Direction.Forward) {
        begin.moveNext();
      } else {
        begin.movePrev();
      }
      switch (entry._tag) {
        case "None": {
          return {
            done: true,
            value: count
          };
        }
        case "Some": {
          return {
            done: false,
            value: entry.value
          };
        }
      }
    }
  };
};
var init_redBlackTree = __esm(() => {
  init_Chunk();
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Predicate();
  init_iterator();
  init_node2();
  RedBlackTreeTypeId = /* @__PURE__ */ Symbol.for(RedBlackTreeSymbolKey);
  redBlackTreeVariance = {
    _Key: (_) => _,
    _Value: (_) => _
  };
  RedBlackTreeProto = {
    [RedBlackTreeTypeId]: redBlackTreeVariance,
    [symbol]() {
      let hash2 = hash(RedBlackTreeSymbolKey);
      for (const item of this) {
        hash2 ^= pipe(hash(item[0]), combine(hash(item[1])));
      }
      return cached(this, hash2);
    },
    [symbol2](that) {
      if (isRedBlackTree(that)) {
        if ((this._root?.count ?? 0) !== (that._root?.count ?? 0)) {
          return false;
        }
        const entries2 = Array.from(that);
        return Array.from(this).every((itemSelf, i) => {
          const itemThat = entries2[i];
          return equals(itemSelf[0], itemThat[0]) && equals(itemSelf[1], itemThat[1]);
        });
      }
      return false;
    },
    [Symbol.iterator]() {
      const stack = [];
      let n = this._root;
      while (n != null) {
        stack.push(n);
        n = n.left;
      }
      return new RedBlackTreeIterator(this, stack, Direction.Forward);
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "RedBlackTree",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/RedBlackTree.js
var keys4;
var init_RedBlackTree = __esm(() => {
  init_redBlackTree();
  init_iterator();
  keys4 = keysForward;
});

// node_modules/effect/dist/esm/SortedSet.js
var TypeId15, SortedSetProto, isSortedSet = (u) => hasProperty(u, TypeId15);
var init_SortedSet = __esm(() => {
  init_Equal();
  init_Function();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_RedBlackTree();
  TypeId15 = /* @__PURE__ */ Symbol.for("effect/SortedSet");
  SortedSetProto = {
    [TypeId15]: {
      _A: (_) => _
    },
    [symbol]() {
      return pipe(hash(this.keyTree), combine(hash(TypeId15)), cached(this));
    },
    [symbol2](that) {
      return isSortedSet(that) && equals(this.keyTree, that.keyTree);
    },
    [Symbol.iterator]() {
      return keys4(this.keyTree);
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "SortedSet",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/supervisor.js
var SupervisorSymbolKey = "effect/Supervisor", SupervisorTypeId, supervisorVariance, ProxySupervisor, Zip, isZip = (self) => hasProperty(self, SupervisorTypeId) && isTagged(self, "Zip"), Track, Const, unsafeTrack = () => {
  return new Track;
}, track, fromEffect = (effect) => {
  return new Const(effect);
}, none8;
var init_supervisor = __esm(() => {
  init_Function();
  init_GlobalValue();
  init_MutableRef();
  init_Predicate();
  init_SortedSet();
  init_core();
  SupervisorTypeId = /* @__PURE__ */ Symbol.for(SupervisorSymbolKey);
  supervisorVariance = {
    _T: (_) => _
  };
  ProxySupervisor = class ProxySupervisor {
    underlying;
    value0;
    [SupervisorTypeId] = supervisorVariance;
    constructor(underlying, value0) {
      this.underlying = underlying;
      this.value0 = value0;
    }
    get value() {
      return this.value0;
    }
    onStart(context2, effect, parent, fiber) {
      this.underlying.onStart(context2, effect, parent, fiber);
    }
    onEnd(value, fiber) {
      this.underlying.onEnd(value, fiber);
    }
    onEffect(fiber, effect) {
      this.underlying.onEffect(fiber, effect);
    }
    onSuspend(fiber) {
      this.underlying.onSuspend(fiber);
    }
    onResume(fiber) {
      this.underlying.onResume(fiber);
    }
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map9(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
  };
  Zip = class Zip {
    left;
    right;
    _tag = "Zip";
    [SupervisorTypeId] = supervisorVariance;
    constructor(left3, right3) {
      this.left = left3;
      this.right = right3;
    }
    get value() {
      return zip2(this.left.value, this.right.value);
    }
    onStart(context2, effect, parent, fiber) {
      this.left.onStart(context2, effect, parent, fiber);
      this.right.onStart(context2, effect, parent, fiber);
    }
    onEnd(value, fiber) {
      this.left.onEnd(value, fiber);
      this.right.onEnd(value, fiber);
    }
    onEffect(fiber, effect) {
      this.left.onEffect(fiber, effect);
      this.right.onEffect(fiber, effect);
    }
    onSuspend(fiber) {
      this.left.onSuspend(fiber);
      this.right.onSuspend(fiber);
    }
    onResume(fiber) {
      this.left.onResume(fiber);
      this.right.onResume(fiber);
    }
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map9(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
  };
  Track = class Track {
    [SupervisorTypeId] = supervisorVariance;
    fibers = /* @__PURE__ */ new Set;
    get value() {
      return sync(() => Array.from(this.fibers));
    }
    onStart(_context, _effect, _parent, fiber) {
      this.fibers.add(fiber);
    }
    onEnd(_value, fiber) {
      this.fibers.delete(fiber);
    }
    onEffect(_fiber, _effect) {}
    onSuspend(_fiber) {}
    onResume(_fiber) {}
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map9(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
    onRun(execution, _fiber) {
      return execution();
    }
  };
  Const = class Const {
    effect;
    [SupervisorTypeId] = supervisorVariance;
    constructor(effect) {
      this.effect = effect;
    }
    get value() {
      return this.effect;
    }
    onStart(_context, _effect, _parent, _fiber) {}
    onEnd(_value, _fiber) {}
    onEffect(_fiber, _effect) {}
    onSuspend(_fiber) {}
    onResume(_fiber) {}
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map9(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
    onRun(execution, _fiber) {
      return execution();
    }
  };
  track = /* @__PURE__ */ sync(unsafeTrack);
  none8 = /* @__PURE__ */ globalValue("effect/Supervisor/none", () => fromEffect(void_));
});

// node_modules/effect/dist/esm/Differ.js
var make34;
var init_Differ = __esm(() => {
  init_Function();
  init_differ();
  init_chunkPatch();
  init_contextPatch();
  init_hashMapPatch();
  init_hashSetPatch();
  init_orPatch();
  init_readonlyArrayPatch();
  make34 = make15;
});

// node_modules/effect/dist/esm/internal/supervisor/patch.js
var OP_EMPTY3 = "Empty", OP_ADD_SUPERVISOR = "AddSupervisor", OP_REMOVE_SUPERVISOR = "RemoveSupervisor", OP_AND_THEN2 = "AndThen", empty29, combine11 = (self, that) => {
  return {
    _tag: OP_AND_THEN2,
    first: self,
    second: that
  };
}, patch11 = (self, supervisor) => {
  return patchLoop(supervisor, of2(self));
}, patchLoop = (_supervisor, _patches) => {
  let supervisor = _supervisor;
  let patches = _patches;
  while (isNonEmpty2(patches)) {
    const head4 = headNonEmpty2(patches);
    switch (head4._tag) {
      case OP_EMPTY3: {
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_ADD_SUPERVISOR: {
        supervisor = supervisor.zip(head4.supervisor);
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_REMOVE_SUPERVISOR: {
        supervisor = removeSupervisor(supervisor, head4.supervisor);
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_AND_THEN2: {
        patches = prepend2(head4.first)(prepend2(head4.second)(tailNonEmpty2(patches)));
        break;
      }
    }
  }
  return supervisor;
}, removeSupervisor = (self, that) => {
  if (equals(self, that)) {
    return none8;
  } else {
    if (isZip(self)) {
      return removeSupervisor(self.left, that).zip(removeSupervisor(self.right, that));
    } else {
      return self;
    }
  }
}, toSet2 = (self) => {
  if (equals(self, none8)) {
    return empty8();
  } else {
    if (isZip(self)) {
      return pipe(toSet2(self.left), union3(toSet2(self.right)));
    } else {
      return make11(self);
    }
  }
}, diff10 = (oldValue, newValue) => {
  if (equals(oldValue, newValue)) {
    return empty29;
  }
  const oldSupervisors = toSet2(oldValue);
  const newSupervisors = toSet2(newValue);
  const added = pipe(newSupervisors, difference3(oldSupervisors), reduce4(empty29, (patch12, supervisor) => combine11(patch12, {
    _tag: OP_ADD_SUPERVISOR,
    supervisor
  })));
  const removed = pipe(oldSupervisors, difference3(newSupervisors), reduce4(empty29, (patch12, supervisor) => combine11(patch12, {
    _tag: OP_REMOVE_SUPERVISOR,
    supervisor
  })));
  return combine11(added, removed);
}, differ2;
var init_patch2 = __esm(() => {
  init_Chunk();
  init_Differ();
  init_Equal();
  init_Function();
  init_HashSet();
  init_supervisor();
  empty29 = {
    _tag: OP_EMPTY3
  };
  differ2 = /* @__PURE__ */ make34({
    empty: empty29,
    patch: patch11,
    combine: combine11,
    diff: diff10
  });
});

// node_modules/effect/dist/esm/internal/fiberRuntime.js
var fiberStarted, fiberActive, fiberSuccesses, fiberFailures, fiberLifetimes, EvaluationSignalContinue = "Continue", EvaluationSignalDone = "Done", EvaluationSignalYieldNow = "Yield", runtimeFiberVariance, absurd = (_) => {
  throw new Error(`BUG: FiberRuntime - ${toStringUnknown(_)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, YieldedOp, yieldedOpChannel, contOpSuccess, drainQueueWhileRunningTable, runBlockedRequests = (self) => forEachSequentialDiscard(flatten3(self), (requestsByRequestResolver) => forEachConcurrentDiscard(sequentialCollectionToChunk(requestsByRequestResolver), ([dataSource, sequential4]) => {
  const map10 = new Map;
  const arr = [];
  for (const block of sequential4) {
    arr.push(toReadonlyArray(block));
    for (const entry of block) {
      map10.set(entry.request, entry);
    }
  }
  const flat = arr.flat();
  return fiberRefLocally(invokeWithInterrupt(dataSource.runAll(arr), flat, () => flat.forEach((entry) => {
    entry.listeners.interrupted = true;
  })), currentRequestMap, map10);
}, false, false)), _version, FiberRuntime, currentMinimumLogLevel, loggerWithConsoleLog = (self) => makeLogger((opts) => {
  const services = getOrDefault2(opts.context, currentServices);
  get3(services, consoleTag).unsafe.log(self.log(opts));
}), defaultLogger, tracerLogger, currentLoggers, annotateLogsScoped = function() {
  if (typeof arguments[0] === "string") {
    return fiberRefLocallyScopedWith(currentLogAnnotations, set3(arguments[0], arguments[1]));
  }
  const entries2 = Object.entries(arguments[0]);
  return fiberRefLocallyScopedWith(currentLogAnnotations, mutate3((annotations2) => {
    for (let i = 0;i < entries2.length; i++) {
      const [key, value] = entries2[i];
      set3(annotations2, key, value);
    }
    return annotations2;
  }));
}, whenLogLevel, acquireRelease, acquireReleaseInterruptible, addFinalizer = (finalizer) => withFiberRuntime((runtime2) => {
  const acquireRefs = runtime2.getFiberRefs();
  const acquireFlags = runtime2.currentRuntimeFlags;
  return flatMap7(scope, (scope) => scopeAddFinalizerExit(scope, (exit2) => withFiberRuntime((runtimeFinalizer) => {
    const preRefs = runtimeFinalizer.getFiberRefs();
    const preFlags = runtimeFinalizer.currentRuntimeFlags;
    const patchRefs = diff9(preRefs, acquireRefs);
    const patchFlags = diff7(preFlags, acquireFlags);
    const inverseRefs = diff9(acquireRefs, preRefs);
    runtimeFinalizer.setFiberRefs(patch10(patchRefs, runtimeFinalizer.id(), acquireRefs));
    return ensuring(withRuntimeFlags(finalizer(exit2), patchFlags), sync(() => {
      runtimeFinalizer.setFiberRefs(patch10(inverseRefs, runtimeFinalizer.id(), runtimeFinalizer.getFiberRefs()));
    }));
  })));
}), daemonChildren = (self) => {
  const forkScope = fiberRefLocally(currentForkScopeOverride, some2(globalScope));
  return forkScope(self);
}, _existsParFound, exists2, existsLoop = (iterator, index, f) => {
  const next = iterator.next();
  if (next.done) {
    return succeed(false);
  }
  return pipe(flatMap7(f(next.value, index), (b) => b ? succeed(b) : existsLoop(iterator, index + 1, f)));
}, filter4, allResolveInput = (input) => {
  if (Array.isArray(input) || isIterable(input)) {
    return [input, none2()];
  }
  const keys5 = Object.keys(input);
  const size8 = keys5.length;
  return [keys5.map((k) => input[k]), some2((values3) => {
    const res = {};
    for (let i = 0;i < size8; i++) {
      res[keys5[i]] = values3[i];
    }
    return res;
  })];
}, allValidate = (effects, reconcile, options) => {
  const eitherEffects = [];
  for (const effect of effects) {
    eitherEffects.push(either2(effect));
  }
  return flatMap7(forEach7(eitherEffects, identity, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), (eithers) => {
    const none9 = none2();
    const size8 = eithers.length;
    const errors = new Array(size8);
    const successes = new Array(size8);
    let errored = false;
    for (let i = 0;i < size8; i++) {
      const either3 = eithers[i];
      if (either3._tag === "Left") {
        errors[i] = some2(either3.left);
        errored = true;
      } else {
        successes[i] = either3.right;
        errors[i] = none9;
      }
    }
    if (errored) {
      return reconcile._tag === "Some" ? fail2(reconcile.value(errors)) : fail2(errors);
    } else if (options?.discard) {
      return void_;
    }
    return reconcile._tag === "Some" ? succeed(reconcile.value(successes)) : succeed(successes);
  });
}, allEither = (effects, reconcile, options) => {
  const eitherEffects = [];
  for (const effect of effects) {
    eitherEffects.push(either2(effect));
  }
  if (options?.discard) {
    return forEach7(eitherEffects, identity, {
      concurrency: options?.concurrency,
      batching: options?.batching,
      discard: true,
      concurrentFinalizers: options?.concurrentFinalizers
    });
  }
  return map9(forEach7(eitherEffects, identity, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), (eithers) => reconcile._tag === "Some" ? reconcile.value(eithers) : eithers);
}, all2 = (arg, options) => {
  const [effects, reconcile] = allResolveInput(arg);
  if (options?.mode === "validate") {
    return allValidate(effects, reconcile, options);
  } else if (options?.mode === "either") {
    return allEither(effects, reconcile, options);
  }
  return options?.discard !== true && reconcile._tag === "Some" ? map9(forEach7(effects, identity, options), reconcile.value) : forEach7(effects, identity, options);
}, allWith = (options) => (arg) => all2(arg, options), allSuccesses = (elements, options) => map9(all2(fromIterable(elements).map(exit), options), filterMap((exit2) => exitIsSuccess(exit2) ? some2(exit2.effect_instruction_i0) : none2())), replicate, replicateEffect, forEach7, forEachParUnbounded = (self, f, batching) => suspend(() => {
  const as2 = fromIterable(self);
  const array4 = new Array(as2.length);
  const fn = (a, i) => flatMap7(f(a, i), (b) => sync(() => array4[i] = b));
  return zipRight(forEachConcurrentDiscard(as2, fn, batching, false), succeed(array4));
}), forEachConcurrentDiscard = (self, f, batching, processAll, n) => uninterruptibleMask((restore) => transplant((graft) => withFiberRuntime((parent) => {
  let todos = Array.from(self).reverse();
  let target = todos.length;
  if (target === 0) {
    return void_;
  }
  let counter6 = 0;
  let interrupted = false;
  const fibersCount = n ? Math.min(todos.length, n) : todos.length;
  const fibers = new Set;
  const results = new Array;
  const interruptAll = () => fibers.forEach((fiber) => {
    fiber.currentScheduler.scheduleTask(() => {
      fiber.unsafeInterruptAsFork(parent.id());
    }, 0);
  });
  const startOrder = new Array;
  const joinOrder = new Array;
  const residual = new Array;
  const collectExits = () => {
    const exits = results.filter(({
      exit: exit2
    }) => exit2._tag === "Failure").sort((a, b) => a.index < b.index ? -1 : a.index === b.index ? 0 : 1).map(({
      exit: exit2
    }) => exit2);
    if (exits.length === 0) {
      exits.push(exitVoid);
    }
    return exits;
  };
  const runFiber = (eff, interruptImmediately = false) => {
    const runnable = uninterruptible(graft(eff));
    const fiber = unsafeForkUnstarted(runnable, parent, parent.currentRuntimeFlags, globalScope);
    parent.currentScheduler.scheduleTask(() => {
      if (interruptImmediately) {
        fiber.unsafeInterruptAsFork(parent.id());
      }
      fiber.resume(runnable);
    }, 0);
    return fiber;
  };
  const onInterruptSignal = () => {
    if (!processAll) {
      target -= todos.length;
      todos = [];
    }
    interrupted = true;
    interruptAll();
  };
  const stepOrExit = batching ? step2 : exit;
  const processingFiber = runFiber(async_((resume2) => {
    const pushResult = (res, index) => {
      if (res._op === "Blocked") {
        residual.push(res);
      } else {
        results.push({
          index,
          exit: res
        });
        if (res._op === "Failure" && !interrupted) {
          onInterruptSignal();
        }
      }
    };
    const next = () => {
      if (todos.length > 0) {
        const a = todos.pop();
        let index = counter6++;
        const returnNextElement = () => {
          const a2 = todos.pop();
          index = counter6++;
          return flatMap7(yieldNow(), () => flatMap7(stepOrExit(restore(f(a2, index))), onRes));
        };
        const onRes = (res) => {
          if (todos.length > 0) {
            pushResult(res, index);
            if (todos.length > 0) {
              return returnNextElement();
            }
          }
          return succeed(res);
        };
        const todo = flatMap7(stepOrExit(restore(f(a, index))), onRes);
        const fiber = runFiber(todo);
        startOrder.push(fiber);
        fibers.add(fiber);
        if (interrupted) {
          fiber.currentScheduler.scheduleTask(() => {
            fiber.unsafeInterruptAsFork(parent.id());
          }, 0);
        }
        fiber.addObserver((wrapped) => {
          let exit2;
          if (wrapped._op === "Failure") {
            exit2 = wrapped;
          } else {
            exit2 = wrapped.effect_instruction_i0;
          }
          joinOrder.push(fiber);
          fibers.delete(fiber);
          pushResult(exit2, index);
          if (results.length === target) {
            resume2(succeed(getOrElse(exitCollectAll(collectExits(), {
              parallel: true
            }), () => exitVoid)));
          } else if (residual.length + results.length === target) {
            const exits = collectExits();
            const requests = residual.map((blocked2) => blocked2.effect_instruction_i0).reduce(par);
            resume2(succeed(blocked(requests, forEachConcurrentDiscard([getOrElse(exitCollectAll(exits, {
              parallel: true
            }), () => exitVoid), ...residual.map((blocked2) => blocked2.effect_instruction_i1)], (i) => i, batching, true, n))));
          } else {
            next();
          }
        });
      }
    };
    for (let i = 0;i < fibersCount; i++) {
      next();
    }
  }));
  return asVoid(onExit(flatten5(restore(join2(processingFiber))), exitMatch({
    onFailure: (cause2) => {
      onInterruptSignal();
      const target2 = residual.length + 1;
      const concurrency = Math.min(typeof n === "number" ? n : residual.length, residual.length);
      const toPop = Array.from(residual);
      return async_((cb) => {
        const exits = [];
        let count = 0;
        let index = 0;
        const check = (index2, hitNext) => (exit2) => {
          exits[index2] = exit2;
          count++;
          if (count === target2) {
            cb(exitSucceed(exitFailCause(cause2)));
          }
          if (toPop.length > 0 && hitNext) {
            next();
          }
        };
        const next = () => {
          runFiber(toPop.pop(), true).addObserver(check(index, true));
          index++;
        };
        processingFiber.addObserver(check(index, false));
        index++;
        for (let i = 0;i < concurrency; i++) {
          next();
        }
      });
    },
    onSuccess: () => forEachSequential(joinOrder, (f2) => f2.inheritAll)
  })));
}))), forEachParN = (self, n, f, batching) => suspend(() => {
  const as2 = fromIterable(self);
  const array4 = new Array(as2.length);
  const fn = (a, i) => map9(f(a, i), (b) => array4[i] = b);
  return zipRight(forEachConcurrentDiscard(as2, fn, batching, false, n), succeed(array4));
}), fork = (self) => withFiberRuntime((state, status) => succeed(unsafeFork(self, state, status.runtimeFlags))), forkDaemon = (self) => forkWithScopeOverride(self, globalScope), forkWithErrorHandler, unsafeFork = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childFiber = unsafeMakeChildFiber(effect, parentFiber, parentRuntimeFlags, overrideScope);
  childFiber.resume(effect);
  return childFiber;
}, unsafeForkUnstarted = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childFiber = unsafeMakeChildFiber(effect, parentFiber, parentRuntimeFlags, overrideScope);
  return childFiber;
}, unsafeMakeChildFiber = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childId = unsafeMake3();
  const parentFiberRefs = parentFiber.getFiberRefs();
  const childFiberRefs = forkAs(parentFiberRefs, childId);
  const childFiber = new FiberRuntime(childId, childFiberRefs, parentRuntimeFlags);
  const childContext = getOrDefault(childFiberRefs, currentContext);
  const supervisor = childFiber.currentSupervisor;
  supervisor.onStart(childContext, effect, some2(parentFiber), childFiber);
  childFiber.addObserver((exit2) => supervisor.onEnd(exit2, childFiber));
  const parentScope = overrideScope !== null ? overrideScope : pipe(parentFiber.getFiberRef(currentForkScopeOverride), getOrElse(() => parentFiber.scope()));
  parentScope.add(parentRuntimeFlags, childFiber);
  return childFiber;
}, forkWithScopeOverride = (self, scopeOverride) => withFiberRuntime((parentFiber, parentStatus) => succeed(unsafeFork(self, parentFiber, parentStatus.runtimeFlags, scopeOverride))), mergeAll3, partition3, validateAll, raceAll = (all3) => {
  const list = fromIterable2(all3);
  if (!isNonEmpty2(list)) {
    return dieSync(() => new IllegalArgumentException(`Received an empty collection of effects`));
  }
  const self = headNonEmpty2(list);
  const effects = tailNonEmpty2(list);
  const inheritAll2 = (res) => pipe(inheritAll(res[1]), as(res[0]));
  return pipe(deferredMake(), flatMap7((done5) => pipe(make28(effects.length), flatMap7((fails) => uninterruptibleMask((restore) => pipe(fork(interruptible2(self)), flatMap7((head4) => pipe(effects, forEachSequential((effect) => fork(interruptible2(effect))), map9((fibers) => unsafeFromArray(fibers)), map9((tail) => pipe(tail, prepend2(head4))), tap((fibers) => pipe(fibers, reduce(void_, (effect, fiber) => pipe(effect, zipRight(pipe(_await2(fiber), flatMap7(raceAllArbiter(fibers, fiber, done5, fails)), fork, asVoid)))))), flatMap7((fibers) => pipe(restore(pipe(_await(done5), flatMap7(inheritAll2))), onInterrupt(() => pipe(fibers, reduce(void_, (effect, fiber) => pipe(effect, zipLeft(interruptFiber(fiber))))))))))))))));
}, raceAllArbiter = (fibers, winner, deferred, fails) => (exit2) => exitMatchEffect(exit2, {
  onFailure: (cause2) => pipe(modify3(fails, (fails2) => [fails2 === 0 ? pipe(deferredFailCause(deferred, cause2), asVoid) : void_, fails2 - 1]), flatten5),
  onSuccess: (value) => pipe(deferredSucceed(deferred, [value, winner]), flatMap7((set6) => set6 ? pipe(fromIterable2(fibers), reduce(void_, (effect, fiber) => fiber === winner ? effect : pipe(effect, zipLeft(interruptFiber(fiber))))) : void_))
}), reduceEffect, parallelFinalizers = (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self,
  onSome: (scope) => {
    switch (scope.strategy._tag) {
      case "Parallel":
        return self;
      case "Sequential":
      case "ParallelN":
        return flatMap7(scopeFork(scope, parallel3), (inner) => scopeExtend(self, inner));
    }
  }
})), parallelNFinalizers = (parallelism) => (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self,
  onSome: (scope) => {
    if (scope.strategy._tag === "ParallelN" && scope.strategy.parallelism === parallelism) {
      return self;
    }
    return flatMap7(scopeFork(scope, parallelN2(parallelism)), (inner) => scopeExtend(self, inner));
  }
})), finalizersMask = (strategy) => (self) => finalizersMaskInternal(strategy, true)(self), finalizersMaskInternal = (strategy, concurrentFinalizers) => (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self(identity),
  onSome: (scope) => {
    if (concurrentFinalizers === true) {
      const patch12 = strategy._tag === "Parallel" ? parallelFinalizers : strategy._tag === "Sequential" ? sequentialFinalizers : parallelNFinalizers(strategy.parallelism);
      switch (scope.strategy._tag) {
        case "Parallel":
          return patch12(self(parallelFinalizers));
        case "Sequential":
          return patch12(self(sequentialFinalizers));
        case "ParallelN":
          return patch12(self(parallelNFinalizers(scope.strategy.parallelism)));
      }
    } else {
      return self(identity);
    }
  }
})), scopeWith = (f) => flatMap7(scopeTag, f), scopedWith = (f) => flatMap7(scopeMake(), (scope) => onExit(f(scope), (exit2) => scope.close(exit2))), scopedEffect = (effect) => flatMap7(scopeMake(), (scope) => scopeUse(effect, scope)), sequentialFinalizers = (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self,
  onSome: (scope) => {
    switch (scope.strategy._tag) {
      case "Sequential":
        return self;
      case "Parallel":
      case "ParallelN":
        return flatMap7(scopeFork(scope, sequential3), (inner) => scopeExtend(self, inner));
    }
  }
})), tagMetricsScoped = (key, value) => labelMetricsScoped([make29(key, value)]), labelMetricsScoped = (labels) => fiberRefLocallyScopedWith(currentMetricLabels, (old) => union(old, labels)), using, validate, validateWith, validateFirst, withClockScoped = (c) => fiberRefLocallyScopedWith(currentServices, add2(clockTag, c)), withRandomScoped = (value) => fiberRefLocallyScopedWith(currentServices, add2(randomTag, value)), withConfigProviderScoped = (provider) => fiberRefLocallyScopedWith(currentServices, add2(configProviderTag, provider)), withEarlyRelease = (self) => scopeWith((parent) => flatMap7(scopeFork(parent, sequential2), (child) => pipe(self, scopeExtend(child), map9((value) => [fiberIdWith((fiberId2) => scopeClose(child, exitInterrupt(fiberId2))), value])))), zipOptions, zipLeftOptions, zipRightOptions, zipWithOptions, withRuntimeFlagsScoped = (update5) => {
  if (update5 === empty18) {
    return void_;
  }
  return pipe(runtimeFlags, flatMap7((runtimeFlags2) => {
    const updatedRuntimeFlags = patch7(runtimeFlags2, update5);
    const revertRuntimeFlags = diff7(updatedRuntimeFlags, runtimeFlags2);
    return pipe(updateRuntimeFlags(update5), zipRight(addFinalizer(() => updateRuntimeFlags(revertRuntimeFlags))), asVoid);
  }), uninterruptible);
}, scopeTag, scope, scopeUnsafeAddFinalizer = (scope2, fin) => {
  if (scope2.state._tag === "Open") {
    scope2.state.finalizers.set({}, fin);
  }
}, ScopeImplProto, scopeUnsafeMake = (strategy = sequential2) => {
  const scope2 = Object.create(ScopeImplProto);
  scope2.strategy = strategy;
  scope2.state = {
    _tag: "Open",
    finalizers: new Map
  };
  return scope2;
}, scopeMake = (strategy = sequential2) => sync(() => scopeUnsafeMake(strategy)), scopeExtend, scopeUse, fiberRefUnsafeMakeSupervisor = (initial) => fiberRefUnsafeMakePatch(initial, {
  differ: differ2,
  fork: empty29
}), fiberRefLocallyScoped, fiberRefLocallyScopedWith, fiberRefMake = (initial, options) => fiberRefMakeWith(() => fiberRefUnsafeMake(initial, options)), fiberRefMakeWith = (ref) => acquireRelease(tap(sync(ref), (ref2) => fiberRefUpdate(ref2, identity)), (fiberRef) => fiberRefDelete(fiberRef)), fiberRefMakeContext = (initial) => fiberRefMakeWith(() => fiberRefUnsafeMakeContext(initial)), fiberRefMakeRuntimeFlags = (initial) => fiberRefMakeWith(() => fiberRefUnsafeMakeRuntimeFlags(initial)), currentRuntimeFlags, currentSupervisor, fiberAwaitAll = (fibers) => forEach7(fibers, _await2), fiberAll = (fibers) => {
  const _fiberAll = {
    ...CommitPrototype2,
    commit() {
      return join2(this);
    },
    [FiberTypeId]: fiberVariance2,
    id: () => fromIterable(fibers).reduce((id, fiber) => combine3(id, fiber.id()), none4),
    await: exit(forEachParUnbounded(fibers, (fiber) => flatten5(fiber.await), false)),
    children: map9(forEachParUnbounded(fibers, (fiber) => fiber.children, false), flatten),
    inheritAll: forEachSequentialDiscard(fibers, (fiber) => fiber.inheritAll),
    poll: map9(forEachSequential(fibers, (fiber) => fiber.poll), reduceRight(some2(exitSucceed(new Array)), (optionB, optionA) => {
      switch (optionA._tag) {
        case "None": {
          return none2();
        }
        case "Some": {
          switch (optionB._tag) {
            case "None": {
              return none2();
            }
            case "Some": {
              return some2(exitZipWith(optionA.value, optionB.value, {
                onSuccess: (a, chunk2) => [a, ...chunk2],
                onFailure: parallel
              }));
            }
          }
        }
      }
    })),
    interruptAsFork: (fiberId2) => forEachSequentialDiscard(fibers, (fiber) => fiber.interruptAsFork(fiberId2))
  };
  return _fiberAll;
}, raceWith, disconnect = (self) => uninterruptibleMask((restore) => fiberIdWith((fiberId2) => flatMap7(forkDaemon(restore(self)), (fiber) => pipe(restore(join2(fiber)), onInterrupt(() => pipe(fiber, interruptAsFork(fiberId2))))))), race, raceFibersWith, completeRace = (winner, loser, cont, ab, cb) => {
  if (compareAndSet(true, false)(ab)) {
    cb(cont(winner, loser));
  }
}, ensuring, invokeWithInterrupt = (self, entries2, onInterrupt2) => fiberIdWith((id) => flatMap7(flatMap7(forkDaemon(interruptible2(self)), (processing) => async_((cb) => {
  const counts = entries2.map((_) => _.listeners.count);
  const checkDone = () => {
    if (counts.every((count) => count === 0)) {
      if (entries2.every((_) => {
        if (_.result.state.current._tag === "Pending") {
          return true;
        } else if (_.result.state.current._tag === "Done" && exitIsExit(_.result.state.current.effect) && _.result.state.current.effect._tag === "Failure" && isInterrupted(_.result.state.current.effect.cause)) {
          return true;
        } else {
          return false;
        }
      })) {
        cleanup.forEach((f) => f());
        onInterrupt2?.();
        cb(interruptFiber(processing));
      }
    }
  };
  processing.addObserver((exit2) => {
    cleanup.forEach((f) => f());
    cb(exit2);
  });
  const cleanup = entries2.map((r, i) => {
    const observer = (count) => {
      counts[i] = count;
      checkDone();
    };
    r.listeners.addObserver(observer);
    return () => r.listeners.removeObserver(observer);
  });
  checkDone();
  return sync(() => {
    cleanup.forEach((f) => f());
  });
})), () => suspend(() => {
  const residual = entries2.flatMap((entry) => {
    if (!entry.state.completed) {
      return [entry];
    }
    return [];
  });
  return forEachSequentialDiscard(residual, (entry) => complete(entry.request, exitInterrupt(id)));
}))), makeSpanScoped = (name, options) => {
  options = addSpanStackTrace(options);
  return uninterruptible(withFiberRuntime((fiber) => {
    const scope2 = unsafeGet3(fiber.getFiberRef(currentContext), scopeTag);
    const span2 = unsafeMakeSpan(fiber, name, options);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const clock_ = get3(fiber.getFiberRef(currentServices), clockTag);
    return as(scopeAddFinalizerExit(scope2, (exit2) => endSpan(span2, exit2, clock_, timingEnabled)), span2);
  }));
}, withTracerScoped = (value) => fiberRefLocallyScopedWith(currentServices, add2(tracerTag, value)), withSpanScoped = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return flatMap7(makeSpanScoped(name, addSpanStackTrace(options)), (span2) => provideService(self, spanTag, span2));
  }
  return (self) => flatMap7(makeSpanScoped(name, addSpanStackTrace(options)), (span2) => provideService(self, spanTag, span2));
};
var init_fiberRuntime = __esm(() => {
  init_Array();
  init_Boolean();
  init_Chunk();
  init_Context();
  init_Deferred();
  init_Effectable();
  init_ExecutionStrategy();
  init_FiberId();
  init_FiberRefs();
  init_FiberRefsPatch();
  init_FiberStatus();
  init_Function();
  init_GlobalValue();
  init_HashMap();
  init_HashSet();
  init_Inspectable();
  init_LogLevel();
  init_Micro();
  init_MutableRef();
  init_Option();
  init_Predicate();
  init_Ref();
  init_RuntimeFlagsPatch();
  init_Scheduler();
  init_Utils();
  init_blockedRequests();
  init_cause();
  init_clock();
  init_completedRequestMap();
  init_concurrency();
  init_configProvider();
  init_core_effect();
  init_core();
  init_defaultServices();
  init_console();
  init_executionStrategy();
  init_fiber();
  init_fiberRefs();
  init_fiberScope();
  init_logger();
  init_metric();
  init_boundaries();
  init_label();
  init_random();
  init_request();
  init_runtimeFlags();
  init_runtimeFlags();
  init_supervisor();
  init_patch2();
  init_tracer();
  fiberStarted = /* @__PURE__ */ counter5("effect_fiber_started", {
    incremental: true
  });
  fiberActive = /* @__PURE__ */ counter5("effect_fiber_active");
  fiberSuccesses = /* @__PURE__ */ counter5("effect_fiber_successes", {
    incremental: true
  });
  fiberFailures = /* @__PURE__ */ counter5("effect_fiber_failures", {
    incremental: true
  });
  fiberLifetimes = /* @__PURE__ */ tagged(/* @__PURE__ */ histogram5("effect_fiber_lifetimes", /* @__PURE__ */ exponential({
    start: 0.5,
    factor: 2,
    count: 35
  })), "time_unit", "milliseconds");
  runtimeFiberVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
  YieldedOp = /* @__PURE__ */ Symbol.for("effect/internal/fiberRuntime/YieldedOp");
  yieldedOpChannel = /* @__PURE__ */ globalValue("effect/internal/fiberRuntime/yieldedOpChannel", () => ({
    currentOp: null
  }));
  contOpSuccess = {
    [OP_ON_SUCCESS]: (_, cont, value) => {
      return internalCall(() => cont.effect_instruction_i1(value));
    },
    ["OnStep"]: (_, _cont, value) => {
      return exitSucceed(exitSucceed(value));
    },
    [OP_ON_SUCCESS_AND_FAILURE]: (_, cont, value) => {
      return internalCall(() => cont.effect_instruction_i2(value));
    },
    [OP_REVERT_FLAGS]: (self, cont, value) => {
      self.patchRuntimeFlags(self.currentRuntimeFlags, cont.patch);
      if (interruptible(self.currentRuntimeFlags) && self.isInterrupted()) {
        return exitFailCause(self.getInterruptedCause());
      } else {
        return exitSucceed(value);
      }
    },
    [OP_WHILE]: (self, cont, value) => {
      internalCall(() => cont.effect_instruction_i2(value));
      if (internalCall(() => cont.effect_instruction_i0())) {
        self.pushStack(cont);
        return internalCall(() => cont.effect_instruction_i1());
      } else {
        return void_;
      }
    },
    [OP_ITERATOR]: (self, cont, value) => {
      const state = internalCall(() => cont.effect_instruction_i0.next(value));
      if (state.done)
        return exitSucceed(state.value);
      self.pushStack(cont);
      return yieldWrapGet(state.value);
    }
  };
  drainQueueWhileRunningTable = {
    [OP_INTERRUPT_SIGNAL]: (self, runtimeFlags2, cur, message) => {
      self.processNewInterruptSignal(message.cause);
      return interruptible(runtimeFlags2) ? exitFailCause(message.cause) : cur;
    },
    [OP_RESUME]: (_self, _runtimeFlags, _cur, _message) => {
      throw new Error("It is illegal to have multiple concurrent run loops in a single fiber");
    },
    [OP_STATEFUL]: (self, runtimeFlags2, cur, message) => {
      message.onFiber(self, running2(runtimeFlags2));
      return cur;
    },
    [OP_YIELD_NOW]: (_self, _runtimeFlags, cur, _message) => {
      return flatMap7(yieldNow(), () => cur);
    }
  };
  _version = /* @__PURE__ */ getCurrentVersion();
  FiberRuntime = class FiberRuntime extends Class {
    [FiberTypeId] = fiberVariance2;
    [RuntimeFiberTypeId] = runtimeFiberVariance;
    _fiberRefs;
    _fiberId;
    _queue = /* @__PURE__ */ new Array;
    _children = null;
    _observers = /* @__PURE__ */ new Array;
    _running = false;
    _stack = [];
    _asyncInterruptor = null;
    _asyncBlockingOn = null;
    _exitValue = null;
    _steps = [];
    _isYielding = false;
    currentRuntimeFlags;
    currentOpCount = 0;
    currentSupervisor;
    currentScheduler;
    currentTracer;
    currentSpan;
    currentContext;
    currentDefaultServices;
    constructor(fiberId2, fiberRefs0, runtimeFlags0) {
      super();
      this.currentRuntimeFlags = runtimeFlags0;
      this._fiberId = fiberId2;
      this._fiberRefs = fiberRefs0;
      if (runtimeMetrics(runtimeFlags0)) {
        const tags = this.getFiberRef(currentMetricLabels);
        fiberStarted.unsafeUpdate(1, tags);
        fiberActive.unsafeUpdate(1, tags);
      }
      this.refreshRefCache();
    }
    commit() {
      return join2(this);
    }
    id() {
      return this._fiberId;
    }
    resume(effect) {
      this.tell(resume(effect));
    }
    get status() {
      return this.ask((_, status) => status);
    }
    get runtimeFlags() {
      return this.ask((state, status) => {
        if (isDone2(status)) {
          return state.currentRuntimeFlags;
        }
        return status.runtimeFlags;
      });
    }
    scope() {
      return unsafeMake7(this);
    }
    get children() {
      return this.ask((fiber) => Array.from(fiber.getChildren()));
    }
    getChildren() {
      if (this._children === null) {
        this._children = new Set;
      }
      return this._children;
    }
    getInterruptedCause() {
      return this.getFiberRef(currentInterruptedCause);
    }
    fiberRefs() {
      return this.ask((fiber) => fiber.getFiberRefs());
    }
    ask(f) {
      return suspend(() => {
        const deferred = deferredUnsafeMake(this._fiberId);
        this.tell(stateful((fiber, status) => {
          deferredUnsafeDone(deferred, sync(() => f(fiber, status)));
        }));
        return deferredAwait(deferred);
      });
    }
    tell(message) {
      this._queue.push(message);
      if (!this._running) {
        this._running = true;
        this.drainQueueLaterOnExecutor();
      }
    }
    get await() {
      return async_((resume2) => {
        const cb = (exit2) => resume2(succeed(exit2));
        this.tell(stateful((fiber, _) => {
          if (fiber._exitValue !== null) {
            cb(this._exitValue);
          } else {
            fiber.addObserver(cb);
          }
        }));
        return sync(() => this.tell(stateful((fiber, _) => {
          fiber.removeObserver(cb);
        })));
      }, this.id());
    }
    get inheritAll() {
      return withFiberRuntime((parentFiber, parentStatus) => {
        const parentFiberId = parentFiber.id();
        const parentFiberRefs = parentFiber.getFiberRefs();
        const parentRuntimeFlags = parentStatus.runtimeFlags;
        const childFiberRefs = this.getFiberRefs();
        const updatedFiberRefs = joinAs(parentFiberRefs, parentFiberId, childFiberRefs);
        parentFiber.setFiberRefs(updatedFiberRefs);
        const updatedRuntimeFlags = parentFiber.getFiberRef(currentRuntimeFlags);
        const patch12 = pipe(diff7(parentRuntimeFlags, updatedRuntimeFlags), exclude2(Interruption), exclude2(WindDown));
        return updateRuntimeFlags(patch12);
      });
    }
    get poll() {
      return sync(() => fromNullable(this._exitValue));
    }
    unsafePoll() {
      return this._exitValue;
    }
    interruptAsFork(fiberId2) {
      return sync(() => this.tell(interruptSignal(interrupt(fiberId2))));
    }
    unsafeInterruptAsFork(fiberId2) {
      this.tell(interruptSignal(interrupt(fiberId2)));
    }
    addObserver(observer) {
      if (this._exitValue !== null) {
        observer(this._exitValue);
      } else {
        this._observers.push(observer);
      }
    }
    removeObserver(observer) {
      this._observers = this._observers.filter((o) => o !== observer);
    }
    getFiberRefs() {
      this.setFiberRef(currentRuntimeFlags, this.currentRuntimeFlags);
      return this._fiberRefs;
    }
    unsafeDeleteFiberRef(fiberRef) {
      this._fiberRefs = delete_(this._fiberRefs, fiberRef);
    }
    getFiberRef(fiberRef) {
      if (this._fiberRefs.locals.has(fiberRef)) {
        return this._fiberRefs.locals.get(fiberRef)[0][1];
      }
      return fiberRef.initial;
    }
    setFiberRef(fiberRef, value) {
      this._fiberRefs = updateAs(this._fiberRefs, {
        fiberId: this._fiberId,
        fiberRef,
        value
      });
      this.refreshRefCache();
    }
    refreshRefCache() {
      this.currentDefaultServices = this.getFiberRef(currentServices);
      this.currentTracer = this.currentDefaultServices.unsafeMap.get(tracerTag.key);
      this.currentSupervisor = this.getFiberRef(currentSupervisor);
      this.currentScheduler = this.getFiberRef(currentScheduler);
      this.currentContext = this.getFiberRef(currentContext);
      this.currentSpan = this.currentContext.unsafeMap.get(spanTag.key);
    }
    setFiberRefs(fiberRefs3) {
      this._fiberRefs = fiberRefs3;
      this.refreshRefCache();
    }
    addChild(child) {
      this.getChildren().add(child);
    }
    removeChild(child) {
      this.getChildren().delete(child);
    }
    transferChildren(scope) {
      const children = this._children;
      this._children = null;
      if (children !== null && children.size > 0) {
        for (const child of children) {
          if (child._exitValue === null) {
            scope.add(this.currentRuntimeFlags, child);
          }
        }
      }
    }
    drainQueueOnCurrentThread() {
      let recurse = true;
      while (recurse) {
        let evaluationSignal = EvaluationSignalContinue;
        const prev = globalThis[currentFiberURI];
        globalThis[currentFiberURI] = this;
        try {
          while (evaluationSignal === EvaluationSignalContinue) {
            evaluationSignal = this._queue.length === 0 ? EvaluationSignalDone : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
          }
        } finally {
          this._running = false;
          globalThis[currentFiberURI] = prev;
        }
        if (this._queue.length > 0 && !this._running) {
          this._running = true;
          if (evaluationSignal === EvaluationSignalYieldNow) {
            this.drainQueueLaterOnExecutor();
            recurse = false;
          } else {
            recurse = true;
          }
        } else {
          recurse = false;
        }
      }
    }
    drainQueueLaterOnExecutor() {
      this.currentScheduler.scheduleTask(this.run, this.getFiberRef(currentSchedulingPriority));
    }
    drainQueueWhileRunning(runtimeFlags2, cur0) {
      let cur = cur0;
      while (this._queue.length > 0) {
        const message = this._queue.splice(0, 1)[0];
        cur = drainQueueWhileRunningTable[message._tag](this, runtimeFlags2, cur, message);
      }
      return cur;
    }
    isInterrupted() {
      return !isEmpty5(this.getFiberRef(currentInterruptedCause));
    }
    addInterruptedCause(cause2) {
      const oldSC = this.getFiberRef(currentInterruptedCause);
      this.setFiberRef(currentInterruptedCause, sequential(oldSC, cause2));
    }
    processNewInterruptSignal(cause2) {
      this.addInterruptedCause(cause2);
      this.sendInterruptSignalToAllChildren();
    }
    sendInterruptSignalToAllChildren() {
      if (this._children === null || this._children.size === 0) {
        return false;
      }
      let told = false;
      for (const child of this._children) {
        child.tell(interruptSignal(interrupt(this.id())));
        told = true;
      }
      return told;
    }
    interruptAllChildren() {
      if (this.sendInterruptSignalToAllChildren()) {
        const it = this._children.values();
        this._children = null;
        let isDone3 = false;
        const body = () => {
          const next = it.next();
          if (!next.done) {
            return asVoid(next.value.await);
          } else {
            return sync(() => {
              isDone3 = true;
            });
          }
        };
        return whileLoop({
          while: () => !isDone3,
          body,
          step: () => {}
        });
      }
      return null;
    }
    reportExitValue(exit2) {
      if (runtimeMetrics(this.currentRuntimeFlags)) {
        const tags = this.getFiberRef(currentMetricLabels);
        const startTimeMillis = this.id().startTimeMillis;
        const endTimeMillis = Date.now();
        fiberLifetimes.unsafeUpdate(endTimeMillis - startTimeMillis, tags);
        fiberActive.unsafeUpdate(-1, tags);
        switch (exit2._tag) {
          case OP_SUCCESS: {
            fiberSuccesses.unsafeUpdate(1, tags);
            break;
          }
          case OP_FAILURE: {
            fiberFailures.unsafeUpdate(1, tags);
            break;
          }
        }
      }
      if (exit2._tag === "Failure") {
        const level = this.getFiberRef(currentUnhandledErrorLogLevel);
        if (!isInterruptedOnly(exit2.cause) && level._tag === "Some") {
          this.log("Fiber terminated with an unhandled error", exit2.cause, level);
        }
      }
    }
    setExitValue(exit2) {
      this._exitValue = exit2;
      this.reportExitValue(exit2);
      for (let i = this._observers.length - 1;i >= 0; i--) {
        this._observers[i](exit2);
      }
      this._observers = [];
    }
    getLoggers() {
      return this.getFiberRef(currentLoggers);
    }
    log(message, cause2, overrideLogLevel) {
      const logLevel = isSome2(overrideLogLevel) ? overrideLogLevel.value : this.getFiberRef(currentLogLevel);
      const minimumLogLevel = this.getFiberRef(currentMinimumLogLevel);
      if (greaterThan2(minimumLogLevel, logLevel)) {
        return;
      }
      const spans = this.getFiberRef(currentLogSpan);
      const annotations2 = this.getFiberRef(currentLogAnnotations);
      const loggers = this.getLoggers();
      const contextMap = this.getFiberRefs();
      if (size3(loggers) > 0) {
        const clockService = get3(this.getFiberRef(currentServices), clockTag);
        const date = new Date(clockService.unsafeCurrentTimeMillis());
        withRedactableContext(contextMap, () => {
          for (const logger of loggers) {
            logger.log({
              fiberId: this.id(),
              logLevel,
              message,
              cause: cause2,
              context: contextMap,
              spans,
              annotations: annotations2,
              date
            });
          }
        });
      }
    }
    evaluateMessageWhileSuspended(message) {
      switch (message._tag) {
        case OP_YIELD_NOW: {
          return EvaluationSignalYieldNow;
        }
        case OP_INTERRUPT_SIGNAL: {
          this.processNewInterruptSignal(message.cause);
          if (this._asyncInterruptor !== null) {
            this._asyncInterruptor(exitFailCause(message.cause));
            this._asyncInterruptor = null;
          }
          return EvaluationSignalContinue;
        }
        case OP_RESUME: {
          this._asyncInterruptor = null;
          this._asyncBlockingOn = null;
          this.evaluateEffect(message.effect);
          return EvaluationSignalContinue;
        }
        case OP_STATEFUL: {
          message.onFiber(this, this._exitValue !== null ? done4 : suspended2(this.currentRuntimeFlags, this._asyncBlockingOn));
          return EvaluationSignalContinue;
        }
        default: {
          return absurd(message);
        }
      }
    }
    evaluateEffect(effect0) {
      this.currentSupervisor.onResume(this);
      try {
        let effect = interruptible(this.currentRuntimeFlags) && this.isInterrupted() ? exitFailCause(this.getInterruptedCause()) : effect0;
        while (effect !== null) {
          const eff = effect;
          const exit2 = this.runLoop(eff);
          if (exit2 === YieldedOp) {
            const op = yieldedOpChannel.currentOp;
            yieldedOpChannel.currentOp = null;
            if (op._op === OP_YIELD) {
              if (cooperativeYielding(this.currentRuntimeFlags)) {
                this.tell(yieldNow3());
                this.tell(resume(exitVoid));
                effect = null;
              } else {
                effect = exitVoid;
              }
            } else if (op._op === OP_ASYNC) {
              effect = null;
            }
          } else {
            this.currentRuntimeFlags = pipe(this.currentRuntimeFlags, enable2(WindDown));
            const interruption2 = this.interruptAllChildren();
            if (interruption2 !== null) {
              effect = flatMap7(interruption2, () => exit2);
            } else {
              if (this._queue.length === 0) {
                this.setExitValue(exit2);
              } else {
                this.tell(resume(exit2));
              }
              effect = null;
            }
          }
        }
      } finally {
        this.currentSupervisor.onSuspend(this);
      }
    }
    start(effect) {
      if (!this._running) {
        this._running = true;
        const prev = globalThis[currentFiberURI];
        globalThis[currentFiberURI] = this;
        try {
          this.evaluateEffect(effect);
        } finally {
          this._running = false;
          globalThis[currentFiberURI] = prev;
          if (this._queue.length > 0) {
            this.drainQueueLaterOnExecutor();
          }
        }
      } else {
        this.tell(resume(effect));
      }
    }
    startFork(effect) {
      this.tell(resume(effect));
    }
    patchRuntimeFlags(oldRuntimeFlags, patch12) {
      const newRuntimeFlags = patch7(oldRuntimeFlags, patch12);
      globalThis[currentFiberURI] = this;
      this.currentRuntimeFlags = newRuntimeFlags;
      return newRuntimeFlags;
    }
    initiateAsync(runtimeFlags2, asyncRegister) {
      let alreadyCalled = false;
      const callback = (effect) => {
        if (!alreadyCalled) {
          alreadyCalled = true;
          this.tell(resume(effect));
        }
      };
      if (interruptible(runtimeFlags2)) {
        this._asyncInterruptor = callback;
      }
      try {
        asyncRegister(callback);
      } catch (e) {
        callback(failCause(die(e)));
      }
    }
    pushStack(cont) {
      this._stack.push(cont);
      if (cont._op === "OnStep") {
        this._steps.push({
          refs: this.getFiberRefs(),
          flags: this.currentRuntimeFlags
        });
      }
    }
    popStack() {
      const item = this._stack.pop();
      if (item) {
        if (item._op === "OnStep") {
          this._steps.pop();
        }
        return item;
      }
      return;
    }
    getNextSuccessCont() {
      let frame = this.popStack();
      while (frame) {
        if (frame._op !== OP_ON_FAILURE) {
          return frame;
        }
        frame = this.popStack();
      }
    }
    getNextFailCont() {
      let frame = this.popStack();
      while (frame) {
        if (frame._op !== OP_ON_SUCCESS && frame._op !== OP_WHILE && frame._op !== OP_ITERATOR) {
          return frame;
        }
        frame = this.popStack();
      }
    }
    [OP_TAG](op) {
      return sync(() => unsafeGet3(this.currentContext, op));
    }
    ["Left"](op) {
      return fail2(op.left);
    }
    ["None"](_) {
      return fail2(new NoSuchElementException);
    }
    ["Right"](op) {
      return exitSucceed(op.right);
    }
    ["Some"](op) {
      return exitSucceed(op.value);
    }
    ["Micro"](op) {
      return unsafeAsync((microResume) => {
        let resume2 = microResume;
        const fiber = runFork(provideContext2(op, this.currentContext));
        fiber.addObserver((exit2) => {
          if (exit2._tag === "Success") {
            return resume2(exitSucceed(exit2.value));
          }
          switch (exit2.cause._tag) {
            case "Interrupt": {
              return resume2(exitFailCause(interrupt(none4)));
            }
            case "Fail": {
              return resume2(fail2(exit2.cause.error));
            }
            case "Die": {
              return resume2(die2(exit2.cause.defect));
            }
          }
        });
        return unsafeAsync((abortResume) => {
          resume2 = (_) => {
            abortResume(void_);
          };
          fiber.unsafeInterrupt();
        });
      });
    }
    [OP_SYNC](op) {
      const value = internalCall(() => op.effect_instruction_i0());
      const cont = this.getNextSuccessCont();
      if (cont !== undefined) {
        if (!(cont._op in contOpSuccess)) {
          absurd(cont);
        }
        return contOpSuccess[cont._op](this, cont, value);
      } else {
        yieldedOpChannel.currentOp = exitSucceed(value);
        return YieldedOp;
      }
    }
    [OP_SUCCESS](op) {
      const oldCur = op;
      const cont = this.getNextSuccessCont();
      if (cont !== undefined) {
        if (!(cont._op in contOpSuccess)) {
          absurd(cont);
        }
        return contOpSuccess[cont._op](this, cont, oldCur.effect_instruction_i0);
      } else {
        yieldedOpChannel.currentOp = oldCur;
        return YieldedOp;
      }
    }
    [OP_FAILURE](op) {
      const cause2 = op.effect_instruction_i0;
      const cont = this.getNextFailCont();
      if (cont !== undefined) {
        switch (cont._op) {
          case OP_ON_FAILURE:
          case OP_ON_SUCCESS_AND_FAILURE: {
            if (!(interruptible(this.currentRuntimeFlags) && this.isInterrupted())) {
              return internalCall(() => cont.effect_instruction_i1(cause2));
            } else {
              return exitFailCause(stripFailures(cause2));
            }
          }
          case "OnStep": {
            if (!(interruptible(this.currentRuntimeFlags) && this.isInterrupted())) {
              return exitSucceed(exitFailCause(cause2));
            } else {
              return exitFailCause(stripFailures(cause2));
            }
          }
          case OP_REVERT_FLAGS: {
            this.patchRuntimeFlags(this.currentRuntimeFlags, cont.patch);
            if (interruptible(this.currentRuntimeFlags) && this.isInterrupted()) {
              return exitFailCause(sequential(cause2, this.getInterruptedCause()));
            } else {
              return exitFailCause(cause2);
            }
          }
          default: {
            absurd(cont);
          }
        }
      } else {
        yieldedOpChannel.currentOp = exitFailCause(cause2);
        return YieldedOp;
      }
    }
    [OP_WITH_RUNTIME](op) {
      return internalCall(() => op.effect_instruction_i0(this, running2(this.currentRuntimeFlags)));
    }
    ["Blocked"](op) {
      const refs = this.getFiberRefs();
      const flags = this.currentRuntimeFlags;
      if (this._steps.length > 0) {
        const frames = [];
        const snap = this._steps[this._steps.length - 1];
        let frame = this.popStack();
        while (frame && frame._op !== "OnStep") {
          frames.push(frame);
          frame = this.popStack();
        }
        this.setFiberRefs(snap.refs);
        this.currentRuntimeFlags = snap.flags;
        const patchRefs = diff9(snap.refs, refs);
        const patchFlags = diff7(snap.flags, flags);
        return exitSucceed(blocked(op.effect_instruction_i0, withFiberRuntime((newFiber) => {
          while (frames.length > 0) {
            newFiber.pushStack(frames.pop());
          }
          newFiber.setFiberRefs(patch10(newFiber.id(), newFiber.getFiberRefs())(patchRefs));
          newFiber.currentRuntimeFlags = patch7(patchFlags)(newFiber.currentRuntimeFlags);
          return op.effect_instruction_i1;
        })));
      }
      return uninterruptibleMask((restore) => flatMap7(forkDaemon(runRequestBlock(op.effect_instruction_i0)), () => restore(op.effect_instruction_i1)));
    }
    ["RunBlocked"](op) {
      return runBlockedRequests(op.effect_instruction_i0);
    }
    [OP_UPDATE_RUNTIME_FLAGS](op) {
      const updateFlags = op.effect_instruction_i0;
      const oldRuntimeFlags = this.currentRuntimeFlags;
      const newRuntimeFlags = patch7(oldRuntimeFlags, updateFlags);
      if (interruptible(newRuntimeFlags) && this.isInterrupted()) {
        return exitFailCause(this.getInterruptedCause());
      } else {
        this.patchRuntimeFlags(this.currentRuntimeFlags, updateFlags);
        if (op.effect_instruction_i1) {
          const revertFlags = diff7(newRuntimeFlags, oldRuntimeFlags);
          this.pushStack(new RevertFlags(revertFlags, op));
          return internalCall(() => op.effect_instruction_i1(oldRuntimeFlags));
        } else {
          return exitVoid;
        }
      }
    }
    [OP_ON_SUCCESS](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    ["OnStep"](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    [OP_ON_FAILURE](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    [OP_ON_SUCCESS_AND_FAILURE](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    [OP_ASYNC](op) {
      this._asyncBlockingOn = op.effect_instruction_i1;
      this.initiateAsync(this.currentRuntimeFlags, op.effect_instruction_i0);
      yieldedOpChannel.currentOp = op;
      return YieldedOp;
    }
    [OP_YIELD](op) {
      this._isYielding = false;
      yieldedOpChannel.currentOp = op;
      return YieldedOp;
    }
    [OP_WHILE](op) {
      const check = op.effect_instruction_i0;
      const body = op.effect_instruction_i1;
      if (check()) {
        this.pushStack(op);
        return body();
      } else {
        return exitVoid;
      }
    }
    [OP_ITERATOR](op) {
      return contOpSuccess[OP_ITERATOR](this, op, undefined);
    }
    [OP_COMMIT](op) {
      return internalCall(() => op.commit());
    }
    runLoop(effect0) {
      let cur = effect0;
      this.currentOpCount = 0;
      while (true) {
        if ((this.currentRuntimeFlags & OpSupervision) !== 0) {
          this.currentSupervisor.onEffect(this, cur);
        }
        if (this._queue.length > 0) {
          cur = this.drainQueueWhileRunning(this.currentRuntimeFlags, cur);
        }
        if (!this._isYielding) {
          this.currentOpCount += 1;
          const shouldYield = this.currentScheduler.shouldYield(this);
          if (shouldYield !== false) {
            this._isYielding = true;
            this.currentOpCount = 0;
            const oldCur = cur;
            cur = flatMap7(yieldNow({
              priority: shouldYield
            }), () => oldCur);
          }
        }
        try {
          cur = this.currentTracer.context(() => {
            if (_version !== cur[EffectTypeId2]._V) {
              return dieMessage(`Cannot execute an Effect versioned ${cur[EffectTypeId2]._V} with a Runtime of version ${getCurrentVersion()}`);
            }
            return this[cur._op](cur);
          }, this);
          if (cur === YieldedOp) {
            const op = yieldedOpChannel.currentOp;
            if (op._op === OP_YIELD || op._op === OP_ASYNC) {
              return YieldedOp;
            }
            yieldedOpChannel.currentOp = null;
            return op._op === OP_SUCCESS || op._op === OP_FAILURE ? op : exitFailCause(die(op));
          }
        } catch (e) {
          if (cur !== YieldedOp && !hasProperty(cur, "_op") || !(cur._op in this)) {
            cur = dieMessage(`Not a valid effect: ${toStringUnknown(cur)}`);
          } else if (isInterruptedException(e)) {
            cur = exitFailCause(sequential(die(e), interrupt(none4)));
          } else {
            cur = die2(e);
          }
        }
      }
    }
    run = () => {
      this.drainQueueOnCurrentThread();
    };
  };
  currentMinimumLogLevel = /* @__PURE__ */ globalValue("effect/FiberRef/currentMinimumLogLevel", () => fiberRefUnsafeMake(fromLiteral("Info")));
  defaultLogger = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Logger/defaultLogger"), () => loggerWithConsoleLog(stringLogger));
  tracerLogger = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Logger/tracerLogger"), () => makeLogger(({
    annotations: annotations2,
    cause: cause2,
    context: context2,
    fiberId: fiberId2,
    logLevel,
    message
  }) => {
    const span2 = getOption2(getOrDefault(context2, currentContext), spanTag);
    if (span2._tag === "None" || span2.value._tag === "ExternalSpan") {
      return;
    }
    const clockService = unsafeGet3(getOrDefault(context2, currentServices), clockTag);
    const attributes = {};
    for (const [key, value] of annotations2) {
      attributes[key] = value;
    }
    attributes["effect.fiberId"] = threadName2(fiberId2);
    attributes["effect.logLevel"] = logLevel.label;
    if (cause2 !== null && cause2._tag !== "Empty") {
      attributes["effect.cause"] = pretty(cause2, {
        renderErrorCause: true
      });
    }
    span2.value.event(toStringUnknown(Array.isArray(message) ? message[0] : message), clockService.unsafeCurrentTimeNanos(), attributes);
  }));
  currentLoggers = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLoggers"), () => fiberRefUnsafeMakeHashSet(make11(defaultLogger, tracerLogger)));
  whenLogLevel = /* @__PURE__ */ dual(2, (effect, level) => {
    const requiredLogLevel = typeof level === "string" ? fromLiteral(level) : level;
    return withFiberRuntime((fiberState) => {
      const minimumLogLevel = fiberState.getFiberRef(currentMinimumLogLevel);
      if (greaterThan2(minimumLogLevel, requiredLogLevel)) {
        return succeed(none2());
      }
      return map9(effect, some2);
    });
  });
  acquireRelease = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (acquire, release) => uninterruptible(tap(acquire, (a) => addFinalizer((exit2) => release(a, exit2)))));
  acquireReleaseInterruptible = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (acquire, release) => ensuring(acquire, addFinalizer((exit2) => release(exit2))));
  _existsParFound = /* @__PURE__ */ Symbol.for("effect/Effect/existsPar/found");
  exists2 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, predicate, options) => matchSimple(options?.concurrency, () => suspend(() => existsLoop(elements[Symbol.iterator](), 0, predicate)), () => matchEffect(forEach7(elements, (a, i) => if_(predicate(a, i), {
    onTrue: () => fail2(_existsParFound),
    onFalse: () => void_
  }), options), {
    onFailure: (e) => e === _existsParFound ? succeed(true) : fail2(e),
    onSuccess: () => succeed(false)
  })));
  filter4 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, predicate, options) => {
    const predicate_ = options?.negate ? (a, i) => map9(predicate(a, i), not) : predicate;
    return matchSimple(options?.concurrency, () => suspend(() => fromIterable(elements).reduceRight((effect, a, i) => zipWith2(effect, suspend(() => predicate_(a, i)), (list, b) => b ? [a, ...list] : list), sync(() => new Array))), () => map9(forEach7(elements, (a, i) => map9(predicate_(a, i), (b) => b ? some2(a) : none2()), options), getSomes));
  });
  replicate = /* @__PURE__ */ dual(2, (self, n) => Array.from({
    length: n
  }, () => self));
  replicateEffect = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, n, options) => all2(replicate(self, n), options));
  forEach7 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (self, f, options) => withFiberRuntime((r) => {
    const isRequestBatchingEnabled = options?.batching === true || options?.batching === "inherit" && r.getFiberRef(currentRequestBatching);
    if (options?.discard) {
      return match8(options.concurrency, () => finalizersMaskInternal(sequential3, options?.concurrentFinalizers)((restore) => isRequestBatchingEnabled ? forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), true, false, 1) : forEachSequentialDiscard(self, (a, i) => restore(f(a, i)))), () => finalizersMaskInternal(parallel3, options?.concurrentFinalizers)((restore) => forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled, false)), (n) => finalizersMaskInternal(parallelN2(n), options?.concurrentFinalizers)((restore) => forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled, false, n)));
    }
    return match8(options?.concurrency, () => finalizersMaskInternal(sequential3, options?.concurrentFinalizers)((restore) => isRequestBatchingEnabled ? forEachParN(self, 1, (a, i) => restore(f(a, i)), true) : forEachSequential(self, (a, i) => restore(f(a, i)))), () => finalizersMaskInternal(parallel3, options?.concurrentFinalizers)((restore) => forEachParUnbounded(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled)), (n) => finalizersMaskInternal(parallelN2(n), options?.concurrentFinalizers)((restore) => forEachParN(self, n, (a, i) => restore(f(a, i)), isRequestBatchingEnabled)));
  }));
  forkWithErrorHandler = /* @__PURE__ */ dual(2, (self, handler) => fork(onError(self, (cause2) => {
    const either3 = failureOrCause(cause2);
    switch (either3._tag) {
      case "Left":
        return handler(either3.left);
      case "Right":
        return failCause(either3.right);
    }
  })));
  mergeAll3 = /* @__PURE__ */ dual((args2) => isFunction2(args2[2]), (elements, zero3, f, options) => matchSimple(options?.concurrency, () => fromIterable(elements).reduce((acc, a, i) => zipWith2(acc, a, (acc2, a2) => f(acc2, a2, i)), succeed(zero3)), () => flatMap7(make28(zero3), (acc) => flatMap7(forEach7(elements, (effect, i) => flatMap7(effect, (a) => update3(acc, (b) => f(b, a, i))), options), () => get12(acc)))));
  partition3 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => pipe(forEach7(elements, (a, i) => either2(f(a, i)), options), map9((chunk2) => partitionMap2(chunk2, identity))));
  validateAll = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => flatMap7(partition3(elements, f, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), ([es, bs]) => isNonEmptyArray2(es) ? fail2(es) : options?.discard ? void_ : succeed(bs)));
  reduceEffect = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, zero3, f, options) => matchSimple(options?.concurrency, () => fromIterable(elements).reduce((acc, a, i) => zipWith2(acc, a, (acc2, a2) => f(acc2, a2, i)), zero3), () => suspend(() => pipe(mergeAll3([zero3, ...elements], none2(), (acc, elem, i) => {
    switch (acc._tag) {
      case "None": {
        return some2(elem);
      }
      case "Some": {
        return some2(f(acc.value, elem, i));
      }
    }
  }, options), map9((option2) => {
    switch (option2._tag) {
      case "None": {
        throw new Error("BUG: Effect.reduceEffect - please report an issue at https://github.com/Effect-TS/effect/issues");
      }
      case "Some": {
        return option2.value;
      }
    }
  })))));
  using = /* @__PURE__ */ dual(2, (self, use) => scopedWith((scope) => flatMap7(scopeExtend(self, scope), use)));
  validate = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => validateWith(self, that, (a, b) => [a, b], options));
  validateWith = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, f, options) => flatten5(zipWithOptions(exit(self), exit(that), (ea, eb) => exitZipWith(ea, eb, {
    onSuccess: f,
    onFailure: (ca, cb) => options?.concurrent ? parallel(ca, cb) : sequential(ca, cb)
  }), options)));
  validateFirst = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => flip(forEach7(elements, (a, i) => flip(f(a, i)), options)));
  zipOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => zipWithOptions(self, that, (a, b) => [a, b], options));
  zipLeftOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => {
    if (options?.concurrent !== true && (options?.batching === undefined || options.batching === false)) {
      return zipLeft(self, that);
    }
    return zipWithOptions(self, that, (a, _) => a, options);
  });
  zipRightOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => {
    if (options?.concurrent !== true && (options?.batching === undefined || options.batching === false)) {
      return zipRight(self, that);
    }
    return zipWithOptions(self, that, (_, b) => b, options);
  });
  zipWithOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, f, options) => map9(all2([self, that], {
    concurrency: options?.concurrent ? 2 : 1,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), ([a, a2]) => f(a, a2)));
  scopeTag = /* @__PURE__ */ GenericTag("effect/Scope");
  scope = scopeTag;
  ScopeImplProto = {
    [ScopeTypeId]: ScopeTypeId,
    [CloseableScopeTypeId]: CloseableScopeTypeId,
    pipe() {
      return pipeArguments(this, arguments);
    },
    fork(strategy) {
      return sync(() => {
        const newScope = scopeUnsafeMake(strategy);
        if (this.state._tag === "Closed") {
          newScope.state = this.state;
          return newScope;
        }
        const key = {};
        const fin = (exit2) => newScope.close(exit2);
        this.state.finalizers.set(key, fin);
        scopeUnsafeAddFinalizer(newScope, (_) => sync(() => {
          if (this.state._tag === "Open") {
            this.state.finalizers.delete(key);
          }
        }));
        return newScope;
      });
    },
    close(exit2) {
      return suspend(() => {
        if (this.state._tag === "Closed") {
          return void_;
        }
        const finalizers = Array.from(this.state.finalizers.values()).reverse();
        this.state = {
          _tag: "Closed",
          exit: exit2
        };
        if (finalizers.length === 0) {
          return void_;
        }
        return isSequential(this.strategy) ? pipe(forEachSequential(finalizers, (fin) => exit(fin(exit2))), flatMap7((results) => pipe(exitCollectAll(results), map2(exitAsVoid), getOrElse(() => exitVoid)))) : isParallel(this.strategy) ? pipe(forEachParUnbounded(finalizers, (fin) => exit(fin(exit2)), false), flatMap7((results) => pipe(exitCollectAll(results, {
          parallel: true
        }), map2(exitAsVoid), getOrElse(() => exitVoid)))) : pipe(forEachParN(finalizers, this.strategy.parallelism, (fin) => exit(fin(exit2)), false), flatMap7((results) => pipe(exitCollectAll(results, {
          parallel: true
        }), map2(exitAsVoid), getOrElse(() => exitVoid))));
      });
    },
    addFinalizer(fin) {
      return suspend(() => {
        if (this.state._tag === "Closed") {
          return fin(this.state.exit);
        }
        this.state.finalizers.set({}, fin);
        return void_;
      });
    }
  };
  scopeExtend = /* @__PURE__ */ dual(2, (effect, scope2) => mapInputContext(effect, merge3(make6(scopeTag, scope2))));
  scopeUse = /* @__PURE__ */ dual(2, (effect, scope2) => pipe(effect, scopeExtend(scope2), onExit((exit2) => scope2.close(exit2))));
  fiberRefLocallyScoped = /* @__PURE__ */ dual(2, (self, value) => asVoid(acquireRelease(flatMap7(fiberRefGet(self), (oldValue) => as(fiberRefSet(self, value), oldValue)), (oldValue) => fiberRefSet(self, oldValue))));
  fiberRefLocallyScopedWith = /* @__PURE__ */ dual(2, (self, f) => fiberRefGetWith(self, (a) => fiberRefLocallyScoped(self, f(a))));
  currentRuntimeFlags = /* @__PURE__ */ fiberRefUnsafeMakeRuntimeFlags(none5);
  currentSupervisor = /* @__PURE__ */ fiberRefUnsafeMakeSupervisor(none8);
  raceWith = /* @__PURE__ */ dual(3, (self, other, options) => raceFibersWith(self, other, {
    onSelfWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      switch (exit2._tag) {
        case OP_SUCCESS: {
          return flatMap7(winner.inheritAll, () => options.onSelfDone(exit2, loser));
        }
        case OP_FAILURE: {
          return options.onSelfDone(exit2, loser);
        }
      }
    }),
    onOtherWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      switch (exit2._tag) {
        case OP_SUCCESS: {
          return flatMap7(winner.inheritAll, () => options.onOtherDone(exit2, loser));
        }
        case OP_FAILURE: {
          return options.onOtherDone(exit2, loser);
        }
      }
    })
  }));
  race = /* @__PURE__ */ dual(2, (self, that) => fiberIdWith((parentFiberId) => raceWith(self, that, {
    onSelfDone: (exit2, right3) => exitMatchEffect(exit2, {
      onFailure: (cause2) => pipe(join2(right3), mapErrorCause((cause22) => parallel(cause2, cause22))),
      onSuccess: (value) => pipe(right3, interruptAsFiber(parentFiberId), as(value))
    }),
    onOtherDone: (exit2, left3) => exitMatchEffect(exit2, {
      onFailure: (cause2) => pipe(join2(left3), mapErrorCause((cause22) => parallel(cause22, cause2))),
      onSuccess: (value) => pipe(left3, interruptAsFiber(parentFiberId), as(value))
    })
  })));
  raceFibersWith = /* @__PURE__ */ dual(3, (self, other, options) => withFiberRuntime((parentFiber, parentStatus) => {
    const parentRuntimeFlags = parentStatus.runtimeFlags;
    const raceIndicator = make12(true);
    const leftFiber = unsafeMakeChildFiber(self, parentFiber, parentRuntimeFlags, options.selfScope);
    const rightFiber = unsafeMakeChildFiber(other, parentFiber, parentRuntimeFlags, options.otherScope);
    return async_((cb) => {
      leftFiber.addObserver(() => completeRace(leftFiber, rightFiber, options.onSelfWin, raceIndicator, cb));
      rightFiber.addObserver(() => completeRace(rightFiber, leftFiber, options.onOtherWin, raceIndicator, cb));
      leftFiber.startFork(self);
      rightFiber.startFork(other);
    }, combine3(leftFiber.id(), rightFiber.id()));
  }));
  ensuring = /* @__PURE__ */ dual(2, (self, finalizer) => uninterruptibleMask((restore) => matchCauseEffect(restore(self), {
    onFailure: (cause1) => matchCauseEffect(finalizer, {
      onFailure: (cause2) => failCause(sequential(cause1, cause2)),
      onSuccess: () => failCause(cause1)
    }),
    onSuccess: (a) => as(finalizer, a)
  })));
});

// node_modules/effect/dist/esm/internal/cache.js
class KeySetImpl {
  head = undefined;
  tail = undefined;
  add(key) {
    if (key !== this.tail) {
      if (this.tail === undefined) {
        this.head = key;
        this.tail = key;
      } else {
        const previous = key.previous;
        const next = key.next;
        if (next !== undefined) {
          key.next = undefined;
          if (previous !== undefined) {
            previous.next = next;
            next.previous = previous;
          } else {
            this.head = next;
            this.head.previous = undefined;
          }
        }
        this.tail.next = key;
        key.previous = this.tail;
        this.tail = key;
      }
    }
  }
  remove() {
    const key = this.head;
    if (key !== undefined) {
      const next = key.next;
      if (next !== undefined) {
        key.next = undefined;
        this.head = next;
        this.head.previous = undefined;
      } else {
        this.head = undefined;
        this.tail = undefined;
      }
    }
    return key;
  }
}
var complete2 = (key, exit2, entryStats, timeToLiveMillis) => struct({
  _tag: "Complete",
  key,
  exit: exit2,
  entryStats,
  timeToLiveMillis
}), pending2 = (key, deferred) => struct({
  _tag: "Pending",
  key,
  deferred
}), refreshing = (deferred, complete3) => struct({
  _tag: "Refreshing",
  deferred,
  complete: complete3
}), MapKeyTypeId, MapKeyImpl, makeMapKey = (current) => new MapKeyImpl(current), isMapKey = (u) => hasProperty(u, MapKeyTypeId), makeKeySet = () => new KeySetImpl, makeCacheState = (map10, keys5, accesses, updating, hits, misses) => ({
  map: map10,
  keys: keys5,
  accesses,
  updating,
  hits,
  misses
}), initialCacheState = () => makeCacheState(empty21(), makeKeySet(), unbounded(), make12(false), 0, 0), CacheSymbolKey = "effect/Cache", CacheTypeId, cacheVariance, ConsumerCacheSymbolKey = "effect/ConsumerCache", ConsumerCacheTypeId, consumerCacheVariance, makeCacheStats = (options) => options, makeEntryStats = (loadedMillis) => ({
  loadedMillis
}), CacheImpl, unsafeMakeWith = (capacity, lookup, timeToLive) => new CacheImpl(capacity, empty4(), none3, lookup, (exit2) => decode(timeToLive(exit2)));
var init_cache = __esm(() => {
  init_Context();
  init_Deferred();
  init_Duration();
  init_Either();
  init_Equal();
  init_Exit();
  init_Function();
  init_Hash();
  init_MutableHashMap();
  init_MutableQueue();
  init_MutableRef();
  init_Option();
  init_Predicate();
  init_core_effect();
  init_core();
  init_data();
  init_fiberId();
  init_fiberRuntime();
  MapKeyTypeId = /* @__PURE__ */ Symbol.for("effect/Cache/MapKey");
  MapKeyImpl = class MapKeyImpl {
    current;
    [MapKeyTypeId] = MapKeyTypeId;
    previous = undefined;
    next = undefined;
    constructor(current) {
      this.current = current;
    }
    [symbol]() {
      return pipe(hash(this.current), combine(hash(this.previous)), combine(hash(this.next)), cached(this));
    }
    [symbol2](that) {
      if (this === that) {
        return true;
      }
      return isMapKey(that) && equals(this.current, that.current) && equals(this.previous, that.previous) && equals(this.next, that.next);
    }
  };
  CacheTypeId = /* @__PURE__ */ Symbol.for(CacheSymbolKey);
  cacheVariance = {
    _Key: (_) => _,
    _Error: (_) => _,
    _Value: (_) => _
  };
  ConsumerCacheTypeId = /* @__PURE__ */ Symbol.for(ConsumerCacheSymbolKey);
  consumerCacheVariance = {
    _Key: (_) => _,
    _Error: (_) => _,
    _Value: (_) => _
  };
  CacheImpl = class CacheImpl {
    capacity;
    context;
    fiberId;
    lookup;
    timeToLive;
    [CacheTypeId] = cacheVariance;
    [ConsumerCacheTypeId] = consumerCacheVariance;
    cacheState;
    constructor(capacity, context2, fiberId2, lookup, timeToLive) {
      this.capacity = capacity;
      this.context = context2;
      this.fiberId = fiberId2;
      this.lookup = lookup;
      this.timeToLive = timeToLive;
      this.cacheState = initialCacheState();
    }
    get(key) {
      return map9(this.getEither(key), merge);
    }
    get cacheStats() {
      return sync(() => makeCacheStats({
        hits: this.cacheState.hits,
        misses: this.cacheState.misses,
        size: size4(this.cacheState.map)
      }));
    }
    getOption(key) {
      return suspend(() => match2(get8(this.cacheState.map, key), {
        onNone: () => {
          const mapKey = makeMapKey(key);
          this.trackAccess(mapKey);
          this.trackMiss();
          return succeed(none2());
        },
        onSome: (value) => this.resolveMapValue(value)
      }));
    }
    getOptionComplete(key) {
      return suspend(() => match2(get8(this.cacheState.map, key), {
        onNone: () => {
          const mapKey = makeMapKey(key);
          this.trackAccess(mapKey);
          this.trackMiss();
          return succeed(none2());
        },
        onSome: (value) => this.resolveMapValue(value, true)
      }));
    }
    contains(key) {
      return sync(() => has4(this.cacheState.map, key));
    }
    entryStats(key) {
      return sync(() => {
        const option2 = get8(this.cacheState.map, key);
        if (isSome2(option2)) {
          switch (option2.value._tag) {
            case "Complete": {
              const loaded = option2.value.entryStats.loadedMillis;
              return some2(makeEntryStats(loaded));
            }
            case "Pending": {
              return none2();
            }
            case "Refreshing": {
              const loaded = option2.value.complete.entryStats.loadedMillis;
              return some2(makeEntryStats(loaded));
            }
          }
        }
        return none2();
      });
    }
    getEither(key) {
      return suspend(() => {
        const k = key;
        let mapKey = undefined;
        let deferred = undefined;
        let value = getOrUndefined(get8(this.cacheState.map, k));
        if (value === undefined) {
          deferred = unsafeMake4(this.fiberId);
          mapKey = makeMapKey(k);
          if (has4(this.cacheState.map, k)) {
            value = getOrUndefined(get8(this.cacheState.map, k));
          } else {
            set4(this.cacheState.map, k, pending2(mapKey, deferred));
          }
        }
        if (value === undefined) {
          this.trackAccess(mapKey);
          this.trackMiss();
          return map9(this.lookupValueOf(key, deferred), right2);
        } else {
          return flatMap7(this.resolveMapValue(value), match2({
            onNone: () => this.getEither(key),
            onSome: (value2) => succeed(left2(value2))
          }));
        }
      });
    }
    invalidate(key) {
      return sync(() => {
        remove6(this.cacheState.map, key);
      });
    }
    invalidateWhen(key, when2) {
      return sync(() => {
        const value = get8(this.cacheState.map, key);
        if (isSome2(value) && value.value._tag === "Complete") {
          if (value.value.exit._tag === "Success") {
            if (when2(value.value.exit.value)) {
              remove6(this.cacheState.map, key);
            }
          }
        }
      });
    }
    get invalidateAll() {
      return sync(() => {
        this.cacheState.map = empty21();
      });
    }
    refresh(key) {
      return clockWith3((clock2) => suspend(() => {
        const k = key;
        const deferred = unsafeMake4(this.fiberId);
        let value = getOrUndefined(get8(this.cacheState.map, k));
        if (value === undefined) {
          if (has4(this.cacheState.map, k)) {
            value = getOrUndefined(get8(this.cacheState.map, k));
          } else {
            set4(this.cacheState.map, k, pending2(makeMapKey(k), deferred));
          }
        }
        if (value === undefined) {
          return asVoid(this.lookupValueOf(key, deferred));
        } else {
          switch (value._tag) {
            case "Complete": {
              if (this.hasExpired(clock2, value.timeToLiveMillis)) {
                const found = getOrUndefined(get8(this.cacheState.map, k));
                if (equals(found, value)) {
                  remove6(this.cacheState.map, k);
                }
                return asVoid(this.get(key));
              }
              return pipe(this.lookupValueOf(key, deferred), when(() => {
                const current = getOrUndefined(get8(this.cacheState.map, k));
                if (equals(current, value)) {
                  const mapValue = refreshing(deferred, value);
                  set4(this.cacheState.map, k, mapValue);
                  return true;
                }
                return false;
              }), asVoid);
            }
            case "Pending": {
              return _await(value.deferred);
            }
            case "Refreshing": {
              return _await(value.deferred);
            }
          }
        }
      }));
    }
    set(key, value) {
      return clockWith3((clock2) => sync(() => {
        const now = clock2.unsafeCurrentTimeMillis();
        const k = key;
        const lookupResult = succeed2(value);
        const mapValue = complete2(makeMapKey(k), lookupResult, makeEntryStats(now), now + toMillis(decode(this.timeToLive(lookupResult))));
        set4(this.cacheState.map, k, mapValue);
      }));
    }
    get size() {
      return sync(() => {
        return size4(this.cacheState.map);
      });
    }
    get values() {
      return sync(() => {
        const values3 = [];
        for (const entry of this.cacheState.map) {
          if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
            values3.push(entry[1].exit.value);
          }
        }
        return values3;
      });
    }
    get entries() {
      return sync(() => {
        const values3 = [];
        for (const entry of this.cacheState.map) {
          if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
            values3.push([entry[0], entry[1].exit.value]);
          }
        }
        return values3;
      });
    }
    get keys() {
      return sync(() => {
        const keys5 = [];
        for (const entry of this.cacheState.map) {
          if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
            keys5.push(entry[0]);
          }
        }
        return keys5;
      });
    }
    resolveMapValue(value, ignorePending = false) {
      return clockWith3((clock2) => {
        switch (value._tag) {
          case "Complete": {
            this.trackAccess(value.key);
            if (this.hasExpired(clock2, value.timeToLiveMillis)) {
              remove6(this.cacheState.map, value.key.current);
              return succeed(none2());
            }
            this.trackHit();
            return map9(value.exit, some2);
          }
          case "Pending": {
            this.trackAccess(value.key);
            this.trackHit();
            if (ignorePending) {
              return succeed(none2());
            }
            return map9(_await(value.deferred), some2);
          }
          case "Refreshing": {
            this.trackAccess(value.complete.key);
            this.trackHit();
            if (this.hasExpired(clock2, value.complete.timeToLiveMillis)) {
              if (ignorePending) {
                return succeed(none2());
              }
              return map9(_await(value.deferred), some2);
            }
            return map9(value.complete.exit, some2);
          }
        }
      });
    }
    trackHit() {
      this.cacheState.hits = this.cacheState.hits + 1;
    }
    trackMiss() {
      this.cacheState.misses = this.cacheState.misses + 1;
    }
    trackAccess(key) {
      offer(this.cacheState.accesses, key);
      if (compareAndSet(this.cacheState.updating, false, true)) {
        let loop2 = true;
        while (loop2) {
          const key2 = poll(this.cacheState.accesses, EmptyMutableQueue);
          if (key2 === EmptyMutableQueue) {
            loop2 = false;
          } else {
            this.cacheState.keys.add(key2);
          }
        }
        let size8 = size4(this.cacheState.map);
        loop2 = size8 > this.capacity;
        while (loop2) {
          const key2 = this.cacheState.keys.remove();
          if (key2 !== undefined) {
            if (has4(this.cacheState.map, key2.current)) {
              remove6(this.cacheState.map, key2.current);
              size8 = size8 - 1;
              loop2 = size8 > this.capacity;
            }
          } else {
            loop2 = false;
          }
        }
        set2(this.cacheState.updating, false);
      }
    }
    hasExpired(clock2, timeToLiveMillis) {
      return clock2.unsafeCurrentTimeMillis() > timeToLiveMillis;
    }
    lookupValueOf(input, deferred) {
      return clockWith3((clock2) => suspend(() => {
        const key = input;
        return pipe(this.lookup(input), provideContext(this.context), exit, flatMap7((exit2) => {
          const now = clock2.unsafeCurrentTimeMillis();
          const stats = makeEntryStats(now);
          const value = complete2(makeMapKey(key), exit2, stats, now + toMillis(decode(this.timeToLive(exit2))));
          set4(this.cacheState.map, key, value);
          return zipRight(done2(deferred, exit2), exit2);
        }), onInterrupt(() => zipRight(interrupt3(deferred), sync(() => {
          remove6(this.cacheState.map, key);
        }))));
      }));
    }
  };
});

// node_modules/effect/dist/esm/Cache.js
var init_Cache = __esm(() => {
  init_cache();
});

// node_modules/effect/dist/esm/Cause.js
var fail4, die4, interrupt5, isFailType2, failureOrCause2, NoSuchElementException2, pretty2;
var init_Cause = __esm(() => {
  init_cause();
  init_core();
  fail4 = fail;
  die4 = die;
  interrupt5 = interrupt;
  isFailType2 = isFailType;
  failureOrCause2 = failureOrCause;
  NoSuchElementException2 = NoSuchElementException;
  pretty2 = pretty;
});

// node_modules/effect/dist/esm/internal/schedule/interval.js
var IntervalSymbolKey = "effect/ScheduleInterval", IntervalTypeId, empty30, make36 = (startMillis, endMillis) => {
  if (startMillis > endMillis) {
    return empty30;
  }
  return {
    [IntervalTypeId]: IntervalTypeId,
    startMillis,
    endMillis
  };
}, lessThan2, min2, isEmpty7 = (self) => {
  return self.startMillis >= self.endMillis;
}, intersect, after = (startMilliseconds) => {
  return make36(startMilliseconds, Number.POSITIVE_INFINITY);
};
var init_interval = __esm(() => {
  init_Duration();
  init_Function();
  init_Option();
  IntervalTypeId = /* @__PURE__ */ Symbol.for(IntervalSymbolKey);
  empty30 = {
    [IntervalTypeId]: IntervalTypeId,
    startMillis: 0,
    endMillis: 0
  };
  lessThan2 = /* @__PURE__ */ dual(2, (self, that) => min2(self, that) === self);
  min2 = /* @__PURE__ */ dual(2, (self, that) => {
    if (self.endMillis <= that.startMillis)
      return self;
    if (that.endMillis <= self.startMillis)
      return that;
    if (self.startMillis < that.startMillis)
      return self;
    if (that.startMillis < self.startMillis)
      return that;
    if (self.endMillis <= that.endMillis)
      return self;
    return that;
  });
  intersect = /* @__PURE__ */ dual(2, (self, that) => {
    const start = Math.max(self.startMillis, that.startMillis);
    const end = Math.min(self.endMillis, that.endMillis);
    return make36(start, end);
  });
});

// node_modules/effect/dist/esm/ScheduleInterval.js
var empty31, lessThan3, isEmpty8, intersect2, after2;
var init_ScheduleInterval = __esm(() => {
  init_interval();
  empty31 = empty30;
  lessThan3 = lessThan2;
  isEmpty8 = isEmpty7;
  intersect2 = intersect;
  after2 = after;
});

// node_modules/effect/dist/esm/internal/schedule/intervals.js
var IntervalsSymbolKey = "effect/ScheduleIntervals", IntervalsTypeId, make38 = (intervals) => {
  return {
    [IntervalsTypeId]: IntervalsTypeId,
    intervals
  };
}, intersect3, intersectLoop = (_left, _right, _acc) => {
  let left3 = _left;
  let right3 = _right;
  let acc = _acc;
  while (isNonEmpty2(left3) && isNonEmpty2(right3)) {
    const interval = pipe(headNonEmpty2(left3), intersect2(headNonEmpty2(right3)));
    const intervals = isEmpty8(interval) ? acc : pipe(acc, prepend2(interval));
    if (pipe(headNonEmpty2(left3), lessThan3(headNonEmpty2(right3)))) {
      left3 = tailNonEmpty2(left3);
    } else {
      right3 = tailNonEmpty2(right3);
    }
    acc = intervals;
  }
  return make38(reverse2(acc));
}, start = (self) => {
  return pipe(self.intervals, head2, getOrElse(() => empty31)).startMillis;
}, end = (self) => {
  return pipe(self.intervals, head2, getOrElse(() => empty31)).endMillis;
}, lessThan4, isNonEmpty4 = (self) => {
  return isNonEmpty2(self.intervals);
};
var init_intervals = __esm(() => {
  init_Chunk();
  init_Function();
  init_Option();
  init_ScheduleInterval();
  IntervalsTypeId = /* @__PURE__ */ Symbol.for(IntervalsSymbolKey);
  intersect3 = /* @__PURE__ */ dual(2, (self, that) => intersectLoop(self.intervals, that.intervals, empty5()));
  lessThan4 = /* @__PURE__ */ dual(2, (self, that) => start(self) < start(that));
});

// node_modules/effect/dist/esm/ScheduleIntervals.js
var make39, intersect4, start2, end2, lessThan5, isNonEmpty5;
var init_ScheduleIntervals = __esm(() => {
  init_intervals();
  make39 = make38;
  intersect4 = intersect3;
  start2 = start;
  end2 = end;
  lessThan5 = lessThan4;
  isNonEmpty5 = isNonEmpty4;
});

// node_modules/effect/dist/esm/internal/schedule/decision.js
var OP_CONTINUE = "Continue", OP_DONE2 = "Done", _continue = (intervals) => {
  return {
    _tag: OP_CONTINUE,
    intervals
  };
}, continueWith = (interval) => {
  return {
    _tag: OP_CONTINUE,
    intervals: make39(of2(interval))
  };
}, done5, isContinue = (self) => {
  return self._tag === OP_CONTINUE;
}, isDone3 = (self) => {
  return self._tag === OP_DONE2;
};
var init_decision = __esm(() => {
  init_Chunk();
  init_ScheduleIntervals();
  done5 = {
    _tag: OP_DONE2
  };
});

// node_modules/effect/dist/esm/ScheduleDecision.js
var _continue2, continueWith2, done6, isContinue2, isDone4;
var init_ScheduleDecision = __esm(() => {
  init_decision();
  _continue2 = _continue;
  continueWith2 = continueWith;
  done6 = done5;
  isContinue2 = isContinue;
  isDone4 = isDone3;
});

// node_modules/effect/dist/esm/Scope.js
var Scope, close, fork2;
var init_Scope = __esm(() => {
  init_core();
  init_fiberRuntime();
  Scope = scopeTag;
  close = scopeClose;
  fork2 = scopeFork;
});

// node_modules/effect/dist/esm/Data.js
var Error3, TaggedError = (tag) => {
  class Base3 extends Error3 {
    _tag = tag;
  }
  Base3.prototype.name = tag;
  return Base3;
};
var init_Data = __esm(() => {
  init_core();
  init_data();
  init_effectable();
  init_Predicate();
  Error3 = /* @__PURE__ */ function() {
    const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
    return class Base3 extends YieldableError {
      constructor(args2) {
        super(args2?.message, args2?.cause ? {
          cause: args2.cause
        } : undefined);
        if (args2) {
          Object.assign(this, args2);
          Object.defineProperty(this, plainArgsSymbol, {
            value: args2,
            enumerable: false
          });
        }
      }
      toJSON() {
        return {
          ...this[plainArgsSymbol],
          ...this
        };
      }
    };
  }();
});

// node_modules/effect/dist/esm/internal/dateTime.js
var TypeId16, TimeZoneTypeId, Proto2, ProtoUtc, ProtoZoned, ProtoTimeZone, ProtoTimeZoneNamed, ProtoTimeZoneOffset, isDateTime = (u) => hasProperty(u, TypeId16), isTimeZone = (u) => hasProperty(u, TimeZoneTypeId), minEpochMillis, maxEpochMillis, toDateUtc = (self) => new Date(self.epochMillis), toDate = (self) => {
  if (self._tag === "Utc") {
    return new Date(self.epochMillis);
  } else if (self.zone._tag === "Offset") {
    return new Date(self.epochMillis + self.zone.offset);
  } else if (self.adjustedEpochMillis !== undefined) {
    return new Date(self.adjustedEpochMillis);
  }
  const parts2 = self.zone.format.formatToParts(self.epochMillis).filter((_) => _.type !== "literal");
  const date = new Date(0);
  date.setUTCFullYear(Number(parts2[2].value), Number(parts2[0].value) - 1, Number(parts2[1].value));
  date.setUTCHours(Number(parts2[3].value), Number(parts2[4].value), Number(parts2[5].value), Number(parts2[6].value));
  self.adjustedEpochMillis = date.getTime();
  return date;
}, zonedOffset = (self) => {
  const date = toDate(self);
  return date.getTime() - toEpochMillis(self);
}, offsetToString = (offset) => {
  const abs2 = Math.abs(offset);
  let hours2 = Math.floor(abs2 / (60 * 60 * 1000));
  let minutes2 = Math.round(abs2 % (60 * 60 * 1000) / (60 * 1000));
  if (minutes2 === 60) {
    hours2 += 1;
    minutes2 = 0;
  }
  return `${offset < 0 ? "-" : "+"}${String(hours2).padStart(2, "0")}:${String(minutes2).padStart(2, "0")}`;
}, zonedOffsetIso = (self) => offsetToString(zonedOffset(self)), toEpochMillis = (self) => self.epochMillis, formatIsoOffset = (self) => {
  const date = toDate(self);
  return self._tag === "Utc" ? date.toISOString() : `${date.toISOString().slice(0, -1)}${zonedOffsetIso(self)}`;
}, formatIsoZoned = (self) => self.zone._tag === "Offset" ? formatIsoOffset(self) : `${formatIsoOffset(self)}[${self.zone.id}]`;
var init_dateTime = __esm(() => {
  init_Cause();
  init_Clock();
  init_Duration();
  init_Either();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Order();
  init_Predicate();
  init_core_effect();
  init_core();
  TypeId16 = /* @__PURE__ */ Symbol.for("effect/DateTime");
  TimeZoneTypeId = /* @__PURE__ */ Symbol.for("effect/DateTime/TimeZone");
  Proto2 = {
    [TypeId16]: TypeId16,
    pipe() {
      return pipeArguments(this, arguments);
    },
    [NodeInspectSymbol]() {
      return this.toString();
    },
    toJSON() {
      return toDateUtc(this).toJSON();
    }
  };
  ProtoUtc = {
    ...Proto2,
    _tag: "Utc",
    [symbol]() {
      return cached(this, number2(this.epochMillis));
    },
    [symbol2](that) {
      return isDateTime(that) && that._tag === "Utc" && this.epochMillis === that.epochMillis;
    },
    toString() {
      return `DateTime.Utc(${toDateUtc(this).toJSON()})`;
    }
  };
  ProtoZoned = {
    ...Proto2,
    _tag: "Zoned",
    [symbol]() {
      return pipe(number2(this.epochMillis), combine(hash(this.zone)), cached(this));
    },
    [symbol2](that) {
      return isDateTime(that) && that._tag === "Zoned" && this.epochMillis === that.epochMillis && equals(this.zone, that.zone);
    },
    toString() {
      return `DateTime.Zoned(${formatIsoZoned(this)})`;
    }
  };
  ProtoTimeZone = {
    [TimeZoneTypeId]: TimeZoneTypeId,
    [NodeInspectSymbol]() {
      return this.toString();
    }
  };
  ProtoTimeZoneNamed = {
    ...ProtoTimeZone,
    _tag: "Named",
    [symbol]() {
      return cached(this, string(`Named:${this.id}`));
    },
    [symbol2](that) {
      return isTimeZone(that) && that._tag === "Named" && this.id === that.id;
    },
    toString() {
      return `TimeZone.Named(${this.id})`;
    },
    toJSON() {
      return {
        _id: "TimeZone",
        _tag: "Named",
        id: this.id
      };
    }
  };
  ProtoTimeZoneOffset = {
    ...ProtoTimeZone,
    _tag: "Offset",
    [symbol]() {
      return cached(this, string(`Offset:${this.offset}`));
    },
    [symbol2](that) {
      return isTimeZone(that) && that._tag === "Offset" && this.offset === that.offset;
    },
    toString() {
      return `TimeZone.Offset(${offsetToString(this.offset)})`;
    },
    toJSON() {
      return {
        _id: "TimeZone",
        _tag: "Offset",
        offset: this.offset
      };
    }
  };
  minEpochMillis = -8640000000000000 + 12 * 60 * 60 * 1000;
  maxEpochMillis = 8640000000000000 - 14 * 60 * 60 * 1000;
});

// node_modules/effect/dist/esm/String.js
var init_String = __esm(() => {
  init_Equivalence();
  init_Function();
  init_Number();
  init_Option();
  init_Order();
  init_Predicate();
});

// node_modules/effect/dist/esm/Cron.js
var TypeId17, CronProto, isCron = (u) => hasProperty(u, TypeId17), Equivalence3, restrictionsArrayEquals, restrictionsEquals = (self, that) => restrictionsArrayEquals(fromIterable(self), fromIterable(that)), equals4;
var init_Cron = __esm(() => {
  init_Array();
  init_Data();
  init_Either();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_dateTime();
  init_Number();
  init_Option();
  init_Predicate();
  init_String();
  TypeId17 = /* @__PURE__ */ Symbol.for("effect/Cron");
  CronProto = {
    [TypeId17]: TypeId17,
    [symbol2](that) {
      return isCron(that) && equals4(this, that);
    },
    [symbol]() {
      return pipe(hash(this.tz), combine(array2(fromIterable(this.seconds))), combine(array2(fromIterable(this.minutes))), combine(array2(fromIterable(this.hours))), combine(array2(fromIterable(this.days))), combine(array2(fromIterable(this.months))), combine(array2(fromIterable(this.weekdays))), cached(this));
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Cron",
        tz: this.tz,
        seconds: fromIterable(this.seconds),
        minutes: fromIterable(this.minutes),
        hours: fromIterable(this.hours),
        days: fromIterable(this.days),
        months: fromIterable(this.months),
        weekdays: fromIterable(this.weekdays)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  Equivalence3 = /* @__PURE__ */ make((self, that) => restrictionsEquals(self.seconds, that.seconds) && restrictionsEquals(self.minutes, that.minutes) && restrictionsEquals(self.hours, that.hours) && restrictionsEquals(self.days, that.days) && restrictionsEquals(self.months, that.months) && restrictionsEquals(self.weekdays, that.weekdays));
  restrictionsArrayEquals = /* @__PURE__ */ array(number);
  equals4 = /* @__PURE__ */ dual(2, (self, that) => Equivalence3(self, that));
});

// node_modules/effect/dist/esm/Random.js
var init_Random = __esm(() => {
  init_defaultServices();
  init_random();
});

// node_modules/effect/dist/esm/internal/schedule.js
var ScheduleSymbolKey = "effect/Schedule", ScheduleTypeId, isSchedule = (u) => hasProperty(u, ScheduleTypeId), ScheduleDriverSymbolKey = "effect/ScheduleDriver", ScheduleDriverTypeId, scheduleVariance, scheduleDriverVariance, ScheduleImpl, ScheduleDriverImpl, makeWithState = (initial, step3) => new ScheduleImpl(initial, step3), check, checkEffect, driver = (self) => pipe(make27([none2(), self.initial]), map9((ref) => new ScheduleDriverImpl(self, ref))), intersect5, intersectWith, intersectWithLoop = (self, that, input, lState, out, lInterval, rState, out2, rInterval, f) => {
  const combined = f(lInterval, rInterval);
  if (isNonEmpty5(combined)) {
    return succeed([[lState, rState], [out, out2], _continue2(combined)]);
  }
  if (pipe(lInterval, lessThan5(rInterval))) {
    return flatMap7(self.step(end2(lInterval), input, lState), ([lState2, out3, decision]) => {
      if (isDone4(decision)) {
        return succeed([[lState2, rState], [out3, out2], done6]);
      }
      return intersectWithLoop(self, that, input, lState2, out3, decision.intervals, rState, out2, rInterval, f);
    });
  }
  return flatMap7(that.step(end2(rInterval), input, rState), ([rState2, out22, decision]) => {
    if (isDone4(decision)) {
      return succeed([[lState, rState2], [out, out22], done6]);
    }
    return intersectWithLoop(self, that, input, lState, out, lInterval, rState2, out22, decision.intervals, f);
  });
}, map10, mapEffect, passthrough = (self) => makeWithState(self.initial, (now, input, state) => pipe(self.step(now, input, state), map9(([state2, _, decision]) => [state2, input, decision]))), recurs = (n) => whileOutput(forever2, (out) => out < n), unfold2 = (initial, f) => makeWithState(initial, (now, _, state) => sync(() => [f(state), state, continueWith2(after2(now))])), untilInputEffect, whileInputEffect, whileOutput, ScheduleDefectTypeId, ScheduleDefect, isScheduleDefect = (u) => hasProperty(u, ScheduleDefectTypeId), scheduleDefectWrap = (self) => catchAll(self, (e) => die2(new ScheduleDefect(e))), scheduleDefectRefail = (self) => catchAllCause(self, (cause2) => match2(find(cause2, (_) => isDieType(_) && isScheduleDefect(_.defect) ? some2(_.defect) : none2()), {
  onNone: () => failCause(cause2),
  onSome: (error) => fail2(error.error)
})), repeat_Effect, repeat_combined, repeatOrElse_Effect, repeatOrElseEffectLoop = (self, driver2, orElse3, value) => {
  return matchEffect(driver2.next(value), {
    onFailure: () => orDie(driver2.last),
    onSuccess: (b) => matchEffect(self, {
      onFailure: (error) => orElse3(error, some2(b)),
      onSuccess: (value2) => repeatOrElseEffectLoop(self, driver2, orElse3, value2)
    })
  });
}, retry_Effect, retry_combined, retryOrElse_Effect, retryOrElse_EffectLoop = (self, driver2, orElse3) => {
  return catchAll(self, (e) => matchEffect(driver2.next(e), {
    onFailure: () => pipe(driver2.last, orDie, flatMap7((out) => orElse3(e, out))),
    onSuccess: () => retryOrElse_EffectLoop(self, driver2, orElse3)
  }));
}, schedule_Effect, scheduleFrom_Effect, scheduleFrom_EffectLoop = (self, initial, driver2) => matchEffect(driver2.next(initial), {
  onFailure: () => orDie(driver2.last),
  onSuccess: () => flatMap7(self, (a) => scheduleFrom_EffectLoop(self, a, driver2))
}), forever2;
var init_schedule = __esm(() => {
  init_Chunk();
  init_Clock();
  init_Context();
  init_Cron();
  init_Duration();
  init_Either();
  init_Equal();
  init_Function();
  init_Option();
  init_Predicate();
  init_Random();
  init_ScheduleDecision();
  init_ScheduleInterval();
  init_ScheduleIntervals();
  init_cause();
  init_core_effect();
  init_core();
  init_ref();
  ScheduleTypeId = /* @__PURE__ */ Symbol.for(ScheduleSymbolKey);
  ScheduleDriverTypeId = /* @__PURE__ */ Symbol.for(ScheduleDriverSymbolKey);
  scheduleVariance = {
    _Out: (_) => _,
    _In: (_) => _,
    _R: (_) => _
  };
  scheduleDriverVariance = {
    _Out: (_) => _,
    _In: (_) => _,
    _R: (_) => _
  };
  ScheduleImpl = class ScheduleImpl {
    initial;
    step;
    [ScheduleTypeId] = scheduleVariance;
    constructor(initial, step3) {
      this.initial = initial;
      this.step = step3;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  ScheduleDriverImpl = class ScheduleDriverImpl {
    schedule;
    ref;
    [ScheduleDriverTypeId] = scheduleDriverVariance;
    constructor(schedule, ref) {
      this.schedule = schedule;
      this.ref = ref;
    }
    get state() {
      return map9(get11(this.ref), (tuple3) => tuple3[1]);
    }
    get last() {
      return flatMap7(get11(this.ref), ([element, _]) => {
        switch (element._tag) {
          case "None": {
            return failSync(() => new NoSuchElementException);
          }
          case "Some": {
            return succeed(element.value);
          }
        }
      });
    }
    get reset() {
      return set5(this.ref, [none2(), this.schedule.initial]);
    }
    next(input) {
      return pipe(map9(get11(this.ref), (tuple3) => tuple3[1]), flatMap7((state) => pipe(currentTimeMillis2, flatMap7((now) => pipe(suspend(() => this.schedule.step(now, input, state)), flatMap7(([state2, out, decision]) => {
        const setState = set5(this.ref, [some2(out), state2]);
        if (isDone4(decision)) {
          return zipRight(setState, fail2(none2()));
        }
        const millis2 = start2(decision.intervals) - now;
        if (millis2 <= 0) {
          return as(setState, out);
        }
        return pipe(setState, zipRight(sleep3(millis(millis2))), as(out));
      }))))));
    }
  };
  check = /* @__PURE__ */ dual(2, (self, test) => checkEffect(self, (input, out) => sync(() => test(input, out))));
  checkEffect = /* @__PURE__ */ dual(2, (self, test) => makeWithState(self.initial, (now, input, state) => flatMap7(self.step(now, input, state), ([state2, out, decision]) => {
    if (isDone4(decision)) {
      return succeed([state2, out, done6]);
    }
    return map9(test(input, out), (cont) => cont ? [state2, out, decision] : [state2, out, done6]);
  })));
  intersect5 = /* @__PURE__ */ dual(2, (self, that) => intersectWith(self, that, intersect4));
  intersectWith = /* @__PURE__ */ dual(3, (self, that, f) => makeWithState([self.initial, that.initial], (now, input, state) => pipe(zipWith2(self.step(now, input, state[0]), that.step(now, input, state[1]), (a, b) => [a, b]), flatMap7(([[lState, out, lDecision], [rState, out2, rDecision]]) => {
    if (isContinue2(lDecision) && isContinue2(rDecision)) {
      return intersectWithLoop(self, that, input, lState, out, lDecision.intervals, rState, out2, rDecision.intervals, f);
    }
    return succeed([[lState, rState], [out, out2], done6]);
  }))));
  map10 = /* @__PURE__ */ dual(2, (self, f) => mapEffect(self, (out) => sync(() => f(out))));
  mapEffect = /* @__PURE__ */ dual(2, (self, f) => makeWithState(self.initial, (now, input, state) => flatMap7(self.step(now, input, state), ([state2, out, decision]) => map9(f(out), (out2) => [state2, out2, decision]))));
  untilInputEffect = /* @__PURE__ */ dual(2, (self, f) => checkEffect(self, (input, _) => negate(f(input))));
  whileInputEffect = /* @__PURE__ */ dual(2, (self, f) => checkEffect(self, (input, _) => f(input)));
  whileOutput = /* @__PURE__ */ dual(2, (self, f) => check(self, (_, out) => f(out)));
  ScheduleDefectTypeId = /* @__PURE__ */ Symbol.for("effect/Schedule/ScheduleDefect");
  ScheduleDefect = class ScheduleDefect {
    error;
    [ScheduleDefectTypeId];
    constructor(error) {
      this.error = error;
      this[ScheduleDefectTypeId] = ScheduleDefectTypeId;
    }
  };
  repeat_Effect = /* @__PURE__ */ dual(2, (self, schedule) => repeatOrElse_Effect(self, schedule, (e, _) => fail2(e)));
  repeat_combined = /* @__PURE__ */ dual(2, (self, options) => {
    if (isSchedule(options)) {
      return repeat_Effect(self, options);
    }
    const base = options.schedule ?? passthrough(forever2);
    const withWhile = options.while ? whileInputEffect(base, (a) => {
      const applied = options.while(a);
      if (typeof applied === "boolean") {
        return succeed(applied);
      }
      return scheduleDefectWrap(applied);
    }) : base;
    const withUntil = options.until ? untilInputEffect(withWhile, (a) => {
      const applied = options.until(a);
      if (typeof applied === "boolean") {
        return succeed(applied);
      }
      return scheduleDefectWrap(applied);
    }) : withWhile;
    const withTimes = options.times ? intersect5(withUntil, recurs(options.times)).pipe(map10((intersectionPair) => intersectionPair[0])) : withUntil;
    return scheduleDefectRefail(repeat_Effect(self, withTimes));
  });
  repeatOrElse_Effect = /* @__PURE__ */ dual(3, (self, schedule, orElse3) => flatMap7(driver(schedule), (driver2) => matchEffect(self, {
    onFailure: (error) => orElse3(error, none2()),
    onSuccess: (value) => repeatOrElseEffectLoop(self, driver2, orElse3, value)
  })));
  retry_Effect = /* @__PURE__ */ dual(2, (self, policy) => retryOrElse_Effect(self, policy, (e, _) => fail2(e)));
  retry_combined = /* @__PURE__ */ dual(2, (self, options) => {
    if (isSchedule(options)) {
      return retry_Effect(self, options);
    }
    const base = options.schedule ?? forever2;
    const withWhile = options.while ? whileInputEffect(base, (e) => {
      const applied = options.while(e);
      if (typeof applied === "boolean") {
        return succeed(applied);
      }
      return scheduleDefectWrap(applied);
    }) : base;
    const withUntil = options.until ? untilInputEffect(withWhile, (e) => {
      const applied = options.until(e);
      if (typeof applied === "boolean") {
        return succeed(applied);
      }
      return scheduleDefectWrap(applied);
    }) : withWhile;
    const withTimes = options.times ? intersect5(withUntil, recurs(options.times)) : withUntil;
    return scheduleDefectRefail(retry_Effect(self, withTimes));
  });
  retryOrElse_Effect = /* @__PURE__ */ dual(3, (self, policy, orElse3) => flatMap7(driver(policy), (driver2) => retryOrElse_EffectLoop(self, driver2, orElse3)));
  schedule_Effect = /* @__PURE__ */ dual(2, (self, schedule) => scheduleFrom_Effect(self, undefined, schedule));
  scheduleFrom_Effect = /* @__PURE__ */ dual(3, (self, initial, schedule) => flatMap7(driver(schedule), (driver2) => scheduleFrom_EffectLoop(self, initial, driver2)));
  forever2 = /* @__PURE__ */ unfold2(0, (n) => n + 1);
});

// node_modules/effect/dist/esm/internal/effect/circular.js
class Semaphore {
  permits;
  waiters = /* @__PURE__ */ new Set;
  taken = 0;
  constructor(permits) {
    this.permits = permits;
  }
  get free() {
    return this.permits - this.taken;
  }
  take = (n) => asyncInterrupt((resume2) => {
    if (this.free < n) {
      const observer = () => {
        if (this.free < n) {
          return;
        }
        this.waiters.delete(observer);
        this.taken += n;
        resume2(succeed(n));
      };
      this.waiters.add(observer);
      return sync(() => {
        this.waiters.delete(observer);
      });
    }
    this.taken += n;
    return resume2(succeed(n));
  });
  updateTaken = (f) => withFiberRuntime((fiber) => {
    this.taken = f(this.taken);
    if (this.waiters.size > 0) {
      fiber.getFiberRef(currentScheduler).scheduleTask(() => {
        const iter = this.waiters.values();
        let item = iter.next();
        while (item.done === false && this.free > 0) {
          item.value();
          item = iter.next();
        }
      }, fiber.getFiberRef(currentSchedulingPriority));
    }
    return succeed(this.free);
  });
  release = (n) => this.updateTaken((taken) => taken - n);
  releaseAll = /* @__PURE__ */ this.updateTaken((_) => 0);
  withPermits = (n) => (self) => uninterruptibleMask((restore) => flatMap7(restore(this.take(n)), (permits) => ensuring(restore(self), this.release(permits))));
  withPermitsIfAvailable = (n) => (self) => uninterruptibleMask((restore) => suspend(() => {
    if (this.free < n) {
      return succeedNone;
    }
    this.taken += n;
    return ensuring(restore(asSome(self)), this.release(n));
  }));
}
var unsafeMakeSemaphore = (permits) => new Semaphore(permits), makeSemaphore = (permits) => sync(() => unsafeMakeSemaphore(permits)), Latch, unsafeMakeLatch = (open) => new Latch(open ?? false), makeLatch = (open) => sync(() => unsafeMakeLatch(open)), awaitAllChildren = (self) => ensuringChildren(self, fiberAwaitAll), cached2, cachedInvalidateWithTTL, computeCachedValue = (self, timeToLive, start3) => {
  const timeToLiveMillis = toMillis(decode(timeToLive));
  return pipe(deferredMake(), tap((deferred) => intoDeferred(self, deferred)), map9((deferred) => some2([start3 + timeToLiveMillis, deferred])));
}, getCachedValue = (self, timeToLive, cache) => uninterruptibleMask((restore) => pipe(clockWith3((clock2) => clock2.currentTimeMillis), flatMap7((time) => updateSomeAndGetEffectSynchronized(cache, (option2) => {
  switch (option2._tag) {
    case "None": {
      return some2(computeCachedValue(self, timeToLive, time));
    }
    case "Some": {
      const [end3] = option2.value;
      return end3 - time <= 0 ? some2(computeCachedValue(self, timeToLive, time)) : none2();
    }
  }
})), flatMap7((option2) => isNone2(option2) ? dieMessage("BUG: Effect.cachedInvalidate - please report an issue at https://github.com/Effect-TS/effect/issues") : restore(deferredAwait(option2.value[1]))))), invalidateCache = (cache) => set5(cache, none2()), ensuringChild, ensuringChildren, forkAll, forkIn, forkScoped = (self) => scopeWith((scope2) => forkIn(self, scope2)), fromFiber = (fiber) => join2(fiber), fromFiberEffect = (fiber) => suspend(() => flatMap7(fiber, join2)), memoKeySymbol, Key, cachedFunction = (f, eq) => {
  return pipe(sync(() => empty21()), flatMap7(makeSynchronized), map9((ref) => (a) => pipe(ref.modifyEffect((map11) => {
    const result = pipe(map11, get8(new Key(a, eq)));
    if (isNone2(result)) {
      return pipe(deferredMake(), tap((deferred) => pipe(diffFiberRefs(f(a)), intoDeferred(deferred), fork)), map9((deferred) => [deferred, pipe(map11, set4(new Key(a, eq), deferred))]));
    }
    return succeed([result.value, map11]);
  }), flatMap7(deferredAwait), flatMap7(([patch12, b]) => pipe(patchFiberRefs(patch12), as(b))))));
}, raceFirst, scheduleForked, supervised, timeout, timeoutFail, timeoutFailCause, timeoutOption, timeoutTo, SynchronizedSymbolKey = "effect/Ref/SynchronizedRef", SynchronizedTypeId, synchronizedVariance, SynchronizedImpl, makeSynchronized = (value) => sync(() => unsafeMakeSynchronized(value)), unsafeMakeSynchronized = (value) => {
  const ref = unsafeMake6(value);
  const sem = unsafeMakeSemaphore(1);
  return new SynchronizedImpl(ref, sem.withPermits(1));
}, updateSomeAndGetEffectSynchronized, bindAll;
var init_circular = __esm(() => {
  init_Duration();
  init_Effectable();
  init_Equal();
  init_Exit();
  init_FiberId();
  init_Function();
  init_Hash();
  init_MutableHashMap();
  init_Option();
  init_Predicate();
  init_Readable();
  init_Scheduler();
  init_cause();
  init_core_effect();
  init_core();
  init_fiber();
  init_fiberRuntime();
  init_fiberScope();
  init_ref();
  init_schedule();
  init_supervisor();
  Latch = class Latch extends Class {
    isOpen;
    waiters = [];
    scheduled = false;
    constructor(isOpen) {
      super();
      this.isOpen = isOpen;
    }
    commit() {
      return this.await;
    }
    unsafeSchedule(fiber) {
      if (this.scheduled || this.waiters.length === 0) {
        return void_;
      }
      this.scheduled = true;
      fiber.currentScheduler.scheduleTask(this.flushWaiters, fiber.getFiberRef(currentSchedulingPriority));
      return void_;
    }
    flushWaiters = () => {
      this.scheduled = false;
      const waiters = this.waiters;
      this.waiters = [];
      for (let i = 0;i < waiters.length; i++) {
        waiters[i](exitVoid);
      }
    };
    open = /* @__PURE__ */ withFiberRuntime((fiber) => {
      if (this.isOpen) {
        return void_;
      }
      this.isOpen = true;
      return this.unsafeSchedule(fiber);
    });
    unsafeOpen() {
      if (this.isOpen)
        return;
      this.isOpen = true;
      this.flushWaiters();
    }
    release = /* @__PURE__ */ withFiberRuntime((fiber) => {
      if (this.isOpen) {
        return void_;
      }
      return this.unsafeSchedule(fiber);
    });
    await = /* @__PURE__ */ asyncInterrupt((resume2) => {
      if (this.isOpen) {
        return resume2(void_);
      }
      this.waiters.push(resume2);
      return sync(() => {
        const index = this.waiters.indexOf(resume2);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
      });
    });
    unsafeClose() {
      this.isOpen = false;
    }
    close = /* @__PURE__ */ sync(() => {
      this.isOpen = false;
    });
    whenOpen = (self) => {
      return zipRight(this.await, self);
    };
  };
  cached2 = /* @__PURE__ */ dual(2, (self, timeToLive) => map9(cachedInvalidateWithTTL(self, timeToLive), (tuple3) => tuple3[0]));
  cachedInvalidateWithTTL = /* @__PURE__ */ dual(2, (self, timeToLive) => {
    const duration = decode(timeToLive);
    return flatMap7(context(), (env) => map9(makeSynchronized(none2()), (cache) => [provideContext(getCachedValue(self, duration, cache), env), invalidateCache(cache)]));
  });
  ensuringChild = /* @__PURE__ */ dual(2, (self, f) => ensuringChildren(self, (children) => f(fiberAll(children))));
  ensuringChildren = /* @__PURE__ */ dual(2, (self, children) => flatMap7(track, (supervisor) => pipe(supervised(self, supervisor), ensuring(flatMap7(supervisor.value, children)))));
  forkAll = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (effects, options) => options?.discard ? forEachSequentialDiscard(effects, fork) : map9(forEachSequential(effects, fork), fiberAll));
  forkIn = /* @__PURE__ */ dual(2, (self, scope2) => withFiberRuntime((parent, parentStatus) => {
    const scopeImpl = scope2;
    const fiber = unsafeFork(self, parent, parentStatus.runtimeFlags, globalScope);
    if (scopeImpl.state._tag === "Open") {
      const finalizer = () => fiberIdWith((fiberId2) => equals(fiberId2, fiber.id()) ? void_ : asVoid(interruptFiber(fiber)));
      const key = {};
      scopeImpl.state.finalizers.set(key, finalizer);
      fiber.addObserver(() => {
        if (scopeImpl.state._tag === "Closed")
          return;
        scopeImpl.state.finalizers.delete(key);
      });
    } else {
      fiber.unsafeInterruptAsFork(parent.id());
    }
    return succeed(fiber);
  }));
  memoKeySymbol = /* @__PURE__ */ Symbol.for("effect/Effect/memoizeFunction.key");
  Key = class Key {
    a;
    eq;
    [memoKeySymbol] = memoKeySymbol;
    constructor(a, eq) {
      this.a = a;
      this.eq = eq;
    }
    [symbol2](that) {
      if (hasProperty(that, memoKeySymbol)) {
        if (this.eq) {
          return this.eq(this.a, that.a);
        } else {
          return equals(this.a, that.a);
        }
      }
      return false;
    }
    [symbol]() {
      return this.eq ? 0 : cached(this, hash(this.a));
    }
  };
  raceFirst = /* @__PURE__ */ dual(2, (self, that) => pipe(exit(self), race(exit(that)), (effect) => flatten5(effect)));
  scheduleForked = /* @__PURE__ */ dual(2, (self, schedule) => pipe(self, schedule_Effect(schedule), forkScoped));
  supervised = /* @__PURE__ */ dual(2, (self, supervisor) => {
    const supervise = fiberRefLocallyWith(currentSupervisor, (s) => s.zip(supervisor));
    return supervise(self);
  });
  timeout = /* @__PURE__ */ dual(2, (self, duration) => timeoutFail(self, {
    onTimeout: () => timeoutExceptionFromDuration(duration),
    duration
  }));
  timeoutFail = /* @__PURE__ */ dual(2, (self, {
    duration,
    onTimeout
  }) => flatten5(timeoutTo(self, {
    onTimeout: () => failSync(onTimeout),
    onSuccess: succeed,
    duration
  })));
  timeoutFailCause = /* @__PURE__ */ dual(2, (self, {
    duration,
    onTimeout
  }) => flatten5(timeoutTo(self, {
    onTimeout: () => failCauseSync(onTimeout),
    onSuccess: succeed,
    duration
  })));
  timeoutOption = /* @__PURE__ */ dual(2, (self, duration) => timeoutTo(self, {
    duration,
    onSuccess: some2,
    onTimeout: none2
  }));
  timeoutTo = /* @__PURE__ */ dual(2, (self, {
    duration,
    onSuccess,
    onTimeout
  }) => fiberIdWith((parentFiberId) => uninterruptibleMask((restore) => raceFibersWith(restore(self), interruptible2(sleep3(duration)), {
    onSelfWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      if (exit2._tag === "Success") {
        return flatMap7(winner.inheritAll, () => as(interruptAsFiber(loser, parentFiberId), onSuccess(exit2.value)));
      } else {
        return flatMap7(interruptAsFiber(loser, parentFiberId), () => exitFailCause(exit2.cause));
      }
    }),
    onOtherWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      if (exit2._tag === "Success") {
        return flatMap7(winner.inheritAll, () => as(interruptAsFiber(loser, parentFiberId), onTimeout()));
      } else {
        return flatMap7(interruptAsFiber(loser, parentFiberId), () => exitFailCause(exit2.cause));
      }
    }),
    otherScope: globalScope
  }))));
  SynchronizedTypeId = /* @__PURE__ */ Symbol.for(SynchronizedSymbolKey);
  synchronizedVariance = {
    _A: (_) => _
  };
  SynchronizedImpl = class SynchronizedImpl extends Class {
    ref;
    withLock;
    [SynchronizedTypeId] = synchronizedVariance;
    [RefTypeId] = refVariance;
    [TypeId13] = TypeId13;
    constructor(ref, withLock) {
      super();
      this.ref = ref;
      this.withLock = withLock;
      this.get = get11(this.ref);
    }
    get;
    commit() {
      return this.get;
    }
    modify(f) {
      return this.modifyEffect((a) => succeed(f(a)));
    }
    modifyEffect(f) {
      return this.withLock(pipe(flatMap7(get11(this.ref), f), flatMap7(([b, a]) => as(set5(this.ref, a), b))));
    }
  };
  updateSomeAndGetEffectSynchronized = /* @__PURE__ */ dual(2, (self, pf) => self.modifyEffect((value) => {
    const result = pf(value);
    switch (result._tag) {
      case "None": {
        return succeed([value, value]);
      }
      case "Some": {
        return map9(result.value, (a) => [a, a]);
      }
    }
  }));
  bindAll = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, f, options) => flatMap7(self, (a) => all2(f(a), options).pipe(map9((record) => Object.assign({}, a, record)))));
});

// node_modules/effect/dist/esm/internal/managedRuntime/circular.js
var TypeId18;
var init_circular2 = __esm(() => {
  TypeId18 = /* @__PURE__ */ Symbol.for("effect/ManagedRuntime");
});

// node_modules/effect/dist/esm/internal/opCodes/layer.js
var OP_EXTEND_SCOPE = "ExtendScope", OP_FOLD = "Fold", OP_FRESH = "Fresh", OP_FROM_EFFECT = "FromEffect", OP_SCOPED = "Scoped", OP_SUSPEND = "Suspend", OP_PROVIDE = "Provide", OP_PROVIDE_MERGE = "ProvideMerge", OP_ZIP_WITH2 = "ZipWith";

// node_modules/effect/dist/esm/Fiber.js
var interruptAs;
var init_Fiber = __esm(() => {
  init_core();
  init_circular();
  init_fiber();
  init_fiberRuntime();
  interruptAs = interruptAsFiber;
});

// node_modules/effect/dist/esm/internal/runtime.js
class RuntimeImpl {
  context;
  runtimeFlags;
  fiberRefs;
  constructor(context2, runtimeFlags2, fiberRefs3) {
    this.context = context2;
    this.runtimeFlags = runtimeFlags2;
    this.fiberRefs = fiberRefs3;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
}
var makeDual = (f) => function() {
  if (arguments.length === 1) {
    const runtime2 = arguments[0];
    return (effect, ...args2) => f(runtime2, effect, ...args2);
  }
  return f.apply(this, arguments);
}, unsafeFork2, unsafeRunCallback, unsafeRunSync, AsyncFiberExceptionImpl, asyncFiberException = (fiber) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new AsyncFiberExceptionImpl(fiber);
  Error.stackTraceLimit = limit;
  return error;
}, FiberFailureId, FiberFailureCauseId, FiberFailureImpl, fiberFailure = (cause2) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new FiberFailureImpl(cause2);
  Error.stackTraceLimit = limit;
  return error;
}, fastPath = (effect) => {
  const op = effect;
  switch (op._op) {
    case "Failure":
    case "Success": {
      return op;
    }
    case "Left": {
      return exitFail(op.left);
    }
    case "Right": {
      return exitSucceed(op.right);
    }
    case "Some": {
      return exitSucceed(op.value);
    }
    case "None": {
      return exitFail(NoSuchElementException());
    }
  }
}, unsafeRunSyncExit, unsafeRunPromise, unsafeRunPromiseExit, make40 = (options) => new RuntimeImpl(options.context, options.runtimeFlags, options.fiberRefs), runtime2 = () => withFiberRuntime((state, status2) => succeed(new RuntimeImpl(state.getFiberRef(currentContext), status2.runtimeFlags, state.getFiberRefs()))), defaultRuntimeFlags, defaultRuntime, unsafeRunEffect, unsafeForkEffect, unsafeRunPromiseEffect, unsafeRunPromiseExitEffect, unsafeRunSyncEffect, unsafeRunSyncExitEffect, asyncEffect = (register) => suspend(() => {
  let cleanup = undefined;
  return flatMap7(deferredMake(), (deferred) => flatMap7(runtime2(), (runtime3) => uninterruptibleMask((restore) => zipRight(fork(restore(matchCauseEffect(register((cb) => unsafeRunCallback(runtime3)(intoDeferred(cb, deferred))), {
    onFailure: (cause2) => deferredFailCause(deferred, cause2),
    onSuccess: (cleanup_) => {
      cleanup = cleanup_;
      return void_;
    }
  }))), restore(onInterrupt(deferredAwait(deferred), () => cleanup ?? void_))))));
});
var init_runtime = __esm(() => {
  init_Context();
  init_Equal();
  init_Exit();
  init_Fiber();
  init_FiberId();
  init_FiberRefs();
  init_Function();
  init_Inspectable();
  init_Option();
  init_Predicate();
  init_Scheduler();
  init_Scope();
  init_cause();
  init_core();
  init_executionStrategy();
  init_fiberRuntime();
  init_fiberScope();
  init_runtimeFlags();
  init_supervisor();
  unsafeFork2 = /* @__PURE__ */ makeDual((runtime2, self, options) => {
    const fiberId2 = unsafeMake3();
    const fiberRefUpdates = [[currentContext, [[fiberId2, runtime2.context]]]];
    if (options?.scheduler) {
      fiberRefUpdates.push([currentScheduler, [[fiberId2, options.scheduler]]]);
    }
    let fiberRefs3 = updateManyAs2(runtime2.fiberRefs, {
      entries: fiberRefUpdates,
      forkAs: fiberId2
    });
    if (options?.updateRefs) {
      fiberRefs3 = options.updateRefs(fiberRefs3, fiberId2);
    }
    const fiberRuntime = new FiberRuntime(fiberId2, fiberRefs3, runtime2.runtimeFlags);
    let effect = self;
    if (options?.scope) {
      effect = flatMap7(fork2(options.scope, sequential2), (closeableScope) => zipRight(scopeAddFinalizer(closeableScope, fiberIdWith((id2) => equals(id2, fiberRuntime.id()) ? void_ : interruptAsFiber(fiberRuntime, id2))), onExit(self, (exit2) => close(closeableScope, exit2))));
    }
    const supervisor = fiberRuntime.currentSupervisor;
    if (supervisor !== none8) {
      supervisor.onStart(runtime2.context, effect, none2(), fiberRuntime);
      fiberRuntime.addObserver((exit2) => supervisor.onEnd(exit2, fiberRuntime));
    }
    globalScope.add(runtime2.runtimeFlags, fiberRuntime);
    if (options?.immediate === false) {
      fiberRuntime.resume(effect);
    } else {
      fiberRuntime.start(effect);
    }
    return fiberRuntime;
  });
  unsafeRunCallback = /* @__PURE__ */ makeDual((runtime2, effect, options = {}) => {
    const fiberRuntime = unsafeFork2(runtime2, effect, options);
    if (options.onExit) {
      fiberRuntime.addObserver((exit2) => {
        options.onExit(exit2);
      });
    }
    return (id2, cancelOptions) => unsafeRunCallback(runtime2)(pipe(fiberRuntime, interruptAs(id2 ?? none4)), {
      ...cancelOptions,
      onExit: cancelOptions?.onExit ? (exit2) => cancelOptions.onExit(flatten6(exit2)) : undefined
    });
  });
  unsafeRunSync = /* @__PURE__ */ makeDual((runtime2, effect) => {
    const result = unsafeRunSyncExit(runtime2)(effect);
    if (result._tag === "Failure") {
      throw fiberFailure(result.effect_instruction_i0);
    }
    return result.effect_instruction_i0;
  });
  AsyncFiberExceptionImpl = class AsyncFiberExceptionImpl extends Error {
    fiber;
    _tag = "AsyncFiberException";
    constructor(fiber) {
      super(`Fiber #${fiber.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`);
      this.fiber = fiber;
      this.name = this._tag;
      this.stack = this.message;
    }
  };
  FiberFailureId = /* @__PURE__ */ Symbol.for("effect/Runtime/FiberFailure");
  FiberFailureCauseId = /* @__PURE__ */ Symbol.for("effect/Runtime/FiberFailure/Cause");
  FiberFailureImpl = class FiberFailureImpl extends Error {
    [FiberFailureId];
    [FiberFailureCauseId];
    constructor(cause2) {
      const head4 = prettyErrors(cause2)[0];
      super(head4?.message || "An error has occurred");
      this[FiberFailureId] = FiberFailureId;
      this[FiberFailureCauseId] = cause2;
      this.name = head4 ? `(FiberFailure) ${head4.name}` : "FiberFailure";
      if (head4?.stack) {
        this.stack = head4.stack;
      }
    }
    toJSON() {
      return {
        _id: "FiberFailure",
        cause: this[FiberFailureCauseId].toJSON()
      };
    }
    toString() {
      return "(FiberFailure) " + pretty(this[FiberFailureCauseId], {
        renderErrorCause: true
      });
    }
    [NodeInspectSymbol]() {
      return this.toString();
    }
  };
  unsafeRunSyncExit = /* @__PURE__ */ makeDual((runtime2, effect) => {
    const op = fastPath(effect);
    if (op) {
      return op;
    }
    const scheduler = new SyncScheduler;
    const fiberRuntime = unsafeFork2(runtime2)(effect, {
      scheduler
    });
    scheduler.flush();
    const result = fiberRuntime.unsafePoll();
    if (result) {
      return result;
    }
    return exitDie(capture(asyncFiberException(fiberRuntime), currentSpanFromFiber(fiberRuntime)));
  });
  unsafeRunPromise = /* @__PURE__ */ makeDual((runtime2, effect, options) => unsafeRunPromiseExit(runtime2, effect, options).then((result) => {
    switch (result._tag) {
      case OP_SUCCESS: {
        return result.effect_instruction_i0;
      }
      case OP_FAILURE: {
        throw fiberFailure(result.effect_instruction_i0);
      }
    }
  }));
  unsafeRunPromiseExit = /* @__PURE__ */ makeDual((runtime2, effect, options) => new Promise((resolve) => {
    const op = fastPath(effect);
    if (op) {
      resolve(op);
    }
    const fiber = unsafeFork2(runtime2)(effect);
    fiber.addObserver((exit2) => {
      resolve(exit2);
    });
    if (options?.signal !== undefined) {
      if (options.signal.aborted) {
        fiber.unsafeInterruptAsFork(fiber.id());
      } else {
        options.signal.addEventListener("abort", () => {
          fiber.unsafeInterruptAsFork(fiber.id());
        }, {
          once: true
        });
      }
    }
  }));
  defaultRuntimeFlags = /* @__PURE__ */ make17(Interruption, CooperativeYielding, RuntimeMetrics);
  defaultRuntime = /* @__PURE__ */ make40({
    context: /* @__PURE__ */ empty4(),
    runtimeFlags: defaultRuntimeFlags,
    fiberRefs: /* @__PURE__ */ empty25()
  });
  unsafeRunEffect = /* @__PURE__ */ unsafeRunCallback(defaultRuntime);
  unsafeForkEffect = /* @__PURE__ */ unsafeFork2(defaultRuntime);
  unsafeRunPromiseEffect = /* @__PURE__ */ unsafeRunPromise(defaultRuntime);
  unsafeRunPromiseExitEffect = /* @__PURE__ */ unsafeRunPromiseExit(defaultRuntime);
  unsafeRunSyncEffect = /* @__PURE__ */ unsafeRunSync(defaultRuntime);
  unsafeRunSyncExitEffect = /* @__PURE__ */ unsafeRunSyncExit(defaultRuntime);
});

// node_modules/effect/dist/esm/internal/synchronizedRef.js
var modifyEffect;
var init_synchronizedRef = __esm(() => {
  init_Function();
  init_Option();
  init_core();
  modifyEffect = /* @__PURE__ */ dual(2, (self, f) => self.modifyEffect(f));
});

// node_modules/effect/dist/esm/internal/layer.js
function fromEffectContext(effect) {
  const fromEffect4 = Object.create(proto3);
  fromEffect4._op_layer = OP_FROM_EFFECT;
  fromEffect4.effect = effect;
  return fromEffect4;
}
var LayerSymbolKey = "effect/Layer", LayerTypeId, layerVariance, proto3, MemoMapTypeIdKey = "effect/Layer/MemoMap", MemoMapTypeId, CurrentMemoMap, isLayer = (u) => hasProperty(u, LayerTypeId), isFresh = (self) => {
  return self._op_layer === OP_FRESH;
}, MemoMapImpl, makeMemoMap, unsafeMakeMemoMap = () => new MemoMapImpl(unsafeMakeSynchronized(new Map)), build = (self) => scopeWith((scope2) => buildWithScope(self, scope2)), buildWithScope, buildWithMemoMap, makeBuilder = (self, scope2, inMemoMap = false) => {
  const op = self;
  switch (op._op_layer) {
    case "Locally": {
      return sync(() => (memoMap) => op.f(memoMap.getOrElseMemoize(op.self, scope2)));
    }
    case "ExtendScope": {
      return sync(() => (memoMap) => scopeWith((scope3) => memoMap.getOrElseMemoize(op.layer, scope3)));
    }
    case "Fold": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.layer, scope2), matchCauseEffect({
        onFailure: (cause2) => memoMap.getOrElseMemoize(op.failureK(cause2), scope2),
        onSuccess: (value) => memoMap.getOrElseMemoize(op.successK(value), scope2)
      })));
    }
    case "Fresh": {
      return sync(() => (_) => pipe(op.layer, buildWithScope(scope2)));
    }
    case "FromEffect": {
      return inMemoMap ? sync(() => (_) => op.effect) : sync(() => (memoMap) => memoMap.getOrElseMemoize(self, scope2));
    }
    case "Provide": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope2), flatMap7((env) => pipe(memoMap.getOrElseMemoize(op.second, scope2), provideContext(env)))));
    }
    case "Scoped": {
      return inMemoMap ? sync(() => (_) => scopeExtend(op.effect, scope2)) : sync(() => (memoMap) => memoMap.getOrElseMemoize(self, scope2));
    }
    case "Suspend": {
      return sync(() => (memoMap) => memoMap.getOrElseMemoize(op.evaluate(), scope2));
    }
    case "ProvideMerge": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope2), zipWith2(memoMap.getOrElseMemoize(op.second, scope2), op.zipK)));
    }
    case "ZipWith": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope2), zipWithOptions(memoMap.getOrElseMemoize(op.second, scope2), op.zipK, {
        concurrent: true
      })));
    }
  }
}, catchAll2, catchAllCause2, die5 = (defect) => failCause5(die4(defect)), dieSync2 = (evaluate2) => failCauseSync2(() => die4(evaluate2())), discard = (self) => map12(self, () => empty4()), context2 = () => fromEffectContext(context()), extendScope = (self) => {
  const extendScope2 = Object.create(proto3);
  extendScope2._op_layer = OP_EXTEND_SCOPE;
  extendScope2.layer = self;
  return extendScope2;
}, fail6 = (error) => failCause5(fail4(error)), failSync2 = (evaluate2) => failCauseSync2(() => fail4(evaluate2())), failCause5 = (cause2) => fromEffectContext(failCause(cause2)), failCauseSync2 = (evaluate2) => fromEffectContext(failCauseSync(evaluate2)), flatMap9, flatten7, fresh = (self) => {
  const fresh2 = Object.create(proto3);
  fresh2._op_layer = OP_FRESH;
  fresh2.layer = self;
  return fresh2;
}, fromEffect3, fromEffectDiscard = (effect) => fromEffectContext(map9(effect, () => empty4())), fiberRefLocally2, locallyEffect, fiberRefLocallyWith2, fiberRefLocallyScoped2 = (self, value) => scopedDiscard(fiberRefLocallyScoped(self, value)), fiberRefLocallyScopedWith2 = (self, value) => scopedDiscard(fiberRefLocallyScopedWith(self, value)), fromFunction = (tagA, tagB, f) => fromEffectContext(map9(tagA, (a) => make6(tagB, f(a)))), launch = (self) => scopedEffect(zipRight(scopeWith((scope2) => pipe(self, buildWithScope(scope2))), never)), map12, mapError2, matchCause2, match12, memoize2 = (self) => scopeWith((scope2) => map9(memoize(buildWithScope(self, scope2)), fromEffectContext)), merge6, mergeAll4 = (...layers) => {
  let final = layers[0];
  for (let i = 1;i < layers.length; i++) {
    final = merge6(final, layers[i]);
  }
  return final;
}, orDie2 = (self) => catchAll2(self, (defect) => die5(defect)), orElse4, passthrough2 = (self) => merge6(context2(), self), project, retry, retryLoop = (self, schedule, stateTag, state) => {
  return pipe(self, catchAll2((error) => pipe(retryUpdate(schedule, stateTag, error, state), flatMap9((env) => fresh(retryLoop(self, schedule, stateTag, pipe(env, get3(stateTag)).state))))));
}, retryUpdate = (schedule, stateTag, error, state) => {
  return fromEffect3(stateTag, pipe(currentTimeMillis2, flatMap7((now) => pipe(schedule.step(now, error, state), flatMap7(([state2, _, decision]) => isDone4(decision) ? fail2(error) : pipe(sleep2(millis(start2(decision.intervals) - now)), as({
    state: state2
  })))))));
}, scoped, scopedDiscard = (effect) => scopedContext(pipe(effect, as(empty4()))), scopedContext = (effect) => {
  const scoped2 = Object.create(proto3);
  scoped2._op_layer = OP_SCOPED;
  scoped2.effect = effect;
  return scoped2;
}, scope2, service = (tag) => fromEffect3(tag, tag), succeed5, succeedContext = (context3) => {
  return fromEffectContext(succeed(context3));
}, empty33, suspend2 = (evaluate2) => {
  const suspend3 = Object.create(proto3);
  suspend3._op_layer = OP_SUSPEND;
  suspend3.evaluate = evaluate2;
  return suspend3;
}, sync2, syncContext = (evaluate2) => {
  return fromEffectContext(sync(evaluate2));
}, tap2, tapError2, tapErrorCause2, toRuntime = (self) => pipe(scopeWith((scope3) => buildWithScope(self, scope3)), flatMap7((context3) => pipe(runtime2(), provideContext(context3)))), toRuntimeWithMemoMap, provide, provideMerge, zipWith5, unwrapEffect = (self) => {
  const tag = GenericTag("effect/Layer/unwrapEffect/Layer.Layer<R1, E1, A>");
  return flatMap9(fromEffect3(tag, self), (context3) => get3(context3, tag));
}, unwrapScoped = (self) => {
  const tag = GenericTag("effect/Layer/unwrapScoped/Layer.Layer<R1, E1, A>");
  return flatMap9(scoped(tag, self), (context3) => get3(context3, tag));
}, annotateLogs2, annotateSpans2, withSpan2 = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return unwrapScoped(map9(options?.onEnd ? tap(makeSpanScoped(name, options), (span2) => addFinalizer((exit2) => options.onEnd(span2, exit2))) : makeSpanScoped(name, options), (span2) => withParentSpan2(self, span2)));
  }
  return (self) => unwrapScoped(map9(options?.onEnd ? tap(makeSpanScoped(name, options), (span2) => addFinalizer((exit2) => options.onEnd(span2, exit2))) : makeSpanScoped(name, options), (span2) => withParentSpan2(self, span2)));
}, withParentSpan2, provideSomeLayer, provideSomeRuntime, effect_provide;
var init_layer = __esm(() => {
  init_Cause();
  init_Clock();
  init_Context();
  init_Duration();
  init_FiberRefsPatch();
  init_Function();
  init_HashMap();
  init_Predicate();
  init_ScheduleDecision();
  init_ScheduleIntervals();
  init_Scope();
  init_core_effect();
  init_core();
  init_circular();
  init_fiberRuntime();
  init_circular2();
  init_ref();
  init_runtime();
  init_runtimeFlags();
  init_synchronizedRef();
  init_tracer();
  LayerTypeId = /* @__PURE__ */ Symbol.for(LayerSymbolKey);
  layerVariance = {
    _RIn: (_) => _,
    _E: (_) => _,
    _ROut: (_) => _
  };
  proto3 = {
    [LayerTypeId]: layerVariance,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  MemoMapTypeId = /* @__PURE__ */ Symbol.for(MemoMapTypeIdKey);
  CurrentMemoMap = /* @__PURE__ */ Reference2()("effect/Layer/CurrentMemoMap", {
    defaultValue: () => unsafeMakeMemoMap()
  });
  MemoMapImpl = class MemoMapImpl {
    ref;
    [MemoMapTypeId];
    constructor(ref) {
      this.ref = ref;
      this[MemoMapTypeId] = MemoMapTypeId;
    }
    getOrElseMemoize(layer, scope2) {
      return pipe(modifyEffect(this.ref, (map12) => {
        const inMap = map12.get(layer);
        if (inMap !== undefined) {
          const [acquire, release] = inMap;
          const cached3 = pipe(acquire, flatMap7(([patch12, b]) => pipe(patchFiberRefs(patch12), as(b))), onExit(exitMatch({
            onFailure: () => void_,
            onSuccess: () => scopeAddFinalizerExit(scope2, release)
          })));
          return succeed([cached3, map12]);
        }
        return pipe(make27(0), flatMap7((observers) => pipe(deferredMake(), flatMap7((deferred) => pipe(make27(() => void_), map9((finalizerRef) => {
          const resource = uninterruptibleMask((restore) => pipe(scopeMake(), flatMap7((innerScope) => pipe(restore(flatMap7(makeBuilder(layer, innerScope, true), (f) => diffFiberRefs(f(this)))), exit, flatMap7((exit2) => {
            switch (exit2._tag) {
              case OP_FAILURE: {
                return pipe(deferredFailCause(deferred, exit2.effect_instruction_i0), zipRight(scopeClose(innerScope, exit2)), zipRight(failCause(exit2.effect_instruction_i0)));
              }
              case OP_SUCCESS: {
                return pipe(set5(finalizerRef, (exit3) => pipe(scopeClose(innerScope, exit3), whenEffect(modify2(observers, (n) => [n === 1, n - 1])), asVoid)), zipRight(update2(observers, (n) => n + 1)), zipRight(scopeAddFinalizerExit(scope2, (exit3) => pipe(sync(() => map12.delete(layer)), zipRight(get11(finalizerRef)), flatMap7((finalizer) => finalizer(exit3))))), zipRight(deferredSucceed(deferred, exit2.effect_instruction_i0)), as(exit2.effect_instruction_i0[1]));
              }
            }
          })))));
          const memoized = [pipe(deferredAwait(deferred), onExit(exitMatchEffect({
            onFailure: () => void_,
            onSuccess: () => update2(observers, (n) => n + 1)
          }))), (exit2) => pipe(get11(finalizerRef), flatMap7((finalizer) => finalizer(exit2)))];
          return [resource, isFresh(layer) ? map12 : map12.set(layer, memoized)];
        }))))));
      }), flatten5);
    }
  };
  makeMemoMap = /* @__PURE__ */ suspend(() => map9(makeSynchronized(new Map), (ref) => new MemoMapImpl(ref)));
  buildWithScope = /* @__PURE__ */ dual(2, (self, scope2) => flatMap7(makeMemoMap, (memoMap) => buildWithMemoMap(self, memoMap, scope2)));
  buildWithMemoMap = /* @__PURE__ */ dual(3, (self, memoMap, scope2) => flatMap7(makeBuilder(self, scope2), (run) => provideService(run(memoMap), CurrentMemoMap, memoMap)));
  catchAll2 = /* @__PURE__ */ dual(2, (self, onFailure) => match12(self, {
    onFailure,
    onSuccess: succeedContext
  }));
  catchAllCause2 = /* @__PURE__ */ dual(2, (self, onFailure) => matchCause2(self, {
    onFailure,
    onSuccess: succeedContext
  }));
  flatMap9 = /* @__PURE__ */ dual(2, (self, f) => match12(self, {
    onFailure: fail6,
    onSuccess: f
  }));
  flatten7 = /* @__PURE__ */ dual(2, (self, tag) => flatMap9(self, get3(tag)));
  fromEffect3 = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const effect = tagFirst ? b : a;
    return fromEffectContext(map9(effect, (service) => make6(tag, service)));
  });
  fiberRefLocally2 = /* @__PURE__ */ dual(3, (self, ref, value) => locallyEffect(self, fiberRefLocally(ref, value)));
  locallyEffect = /* @__PURE__ */ dual(2, (self, f) => {
    const locally = Object.create(proto3);
    locally._op_layer = "Locally";
    locally.self = self;
    locally.f = f;
    return locally;
  });
  fiberRefLocallyWith2 = /* @__PURE__ */ dual(3, (self, ref, value) => locallyEffect(self, fiberRefLocallyWith(ref, value)));
  map12 = /* @__PURE__ */ dual(2, (self, f) => flatMap9(self, (context3) => succeedContext(f(context3))));
  mapError2 = /* @__PURE__ */ dual(2, (self, f) => catchAll2(self, (error) => failSync2(() => f(error))));
  matchCause2 = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    const fold = Object.create(proto3);
    fold._op_layer = OP_FOLD;
    fold.layer = self;
    fold.failureK = onFailure;
    fold.successK = onSuccess;
    return fold;
  });
  match12 = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => matchCause2(self, {
    onFailure: (cause2) => {
      const failureOrCause3 = failureOrCause2(cause2);
      switch (failureOrCause3._tag) {
        case "Left": {
          return onFailure(failureOrCause3.left);
        }
        case "Right": {
          return failCause5(failureOrCause3.right);
        }
      }
    },
    onSuccess
  }));
  merge6 = /* @__PURE__ */ dual(2, (self, that) => zipWith5(self, that, (a, b) => merge3(a, b)));
  orElse4 = /* @__PURE__ */ dual(2, (self, that) => catchAll2(self, that));
  project = /* @__PURE__ */ dual(4, (self, tagA, tagB, f) => map12(self, (context3) => make6(tagB, f(unsafeGet3(context3, tagA)))));
  retry = /* @__PURE__ */ dual(2, (self, schedule) => suspend2(() => {
    const stateTag = GenericTag("effect/Layer/retry/{ state: unknown }");
    return pipe(succeed5(stateTag, {
      state: schedule.initial
    }), flatMap9((env) => retryLoop(self, schedule, stateTag, pipe(env, get3(stateTag)).state)));
  }));
  scoped = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const effect = tagFirst ? b : a;
    return scopedContext(map9(effect, (service) => make6(tag, service)));
  });
  scope2 = /* @__PURE__ */ scopedContext(/* @__PURE__ */ map9(/* @__PURE__ */ acquireRelease(/* @__PURE__ */ scopeMake(), (scope3, exit2) => scope3.close(exit2)), (scope3) => make6(Scope, scope3)));
  succeed5 = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const resource = tagFirst ? b : a;
    return fromEffectContext(succeed(make6(tag, resource)));
  });
  empty33 = /* @__PURE__ */ succeedContext(/* @__PURE__ */ empty4());
  sync2 = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const evaluate2 = tagFirst ? b : a;
    return fromEffectContext(sync(() => make6(tag, evaluate2())));
  });
  tap2 = /* @__PURE__ */ dual(2, (self, f) => flatMap9(self, (context3) => fromEffectContext(as(f(context3), context3))));
  tapError2 = /* @__PURE__ */ dual(2, (self, f) => catchAll2(self, (e) => fromEffectContext(flatMap7(f(e), () => fail2(e)))));
  tapErrorCause2 = /* @__PURE__ */ dual(2, (self, f) => catchAllCause2(self, (cause2) => fromEffectContext(flatMap7(f(cause2), () => failCause(cause2)))));
  toRuntimeWithMemoMap = /* @__PURE__ */ dual(2, (self, memoMap) => flatMap7(scopeWith((scope3) => buildWithMemoMap(self, memoMap, scope3)), (context3) => pipe(runtime2(), provideContext(context3))));
  provide = /* @__PURE__ */ dual(2, (self, that) => suspend2(() => {
    const provideTo = Object.create(proto3);
    provideTo._op_layer = OP_PROVIDE;
    provideTo.first = Object.create(proto3, {
      _op_layer: {
        value: OP_PROVIDE_MERGE,
        enumerable: true
      },
      first: {
        value: context2(),
        enumerable: true
      },
      second: {
        value: Array.isArray(that) ? mergeAll4(...that) : that
      },
      zipK: {
        value: (a, b) => pipe(a, merge3(b))
      }
    });
    provideTo.second = self;
    return provideTo;
  }));
  provideMerge = /* @__PURE__ */ dual(2, (that, self) => {
    const zipWith5 = Object.create(proto3);
    zipWith5._op_layer = OP_PROVIDE_MERGE;
    zipWith5.first = self;
    zipWith5.second = provide(that, self);
    zipWith5.zipK = (a, b) => {
      return pipe(a, merge3(b));
    };
    return zipWith5;
  });
  zipWith5 = /* @__PURE__ */ dual(3, (self, that, f) => suspend2(() => {
    const zipWith6 = Object.create(proto3);
    zipWith6._op_layer = OP_ZIP_WITH2;
    zipWith6.first = self;
    zipWith6.second = that;
    zipWith6.zipK = f;
    return zipWith6;
  }));
  annotateLogs2 = /* @__PURE__ */ dual((args2) => isLayer(args2[0]), function() {
    const args2 = arguments;
    return fiberRefLocallyWith2(args2[0], currentLogAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations2) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations2));
  });
  annotateSpans2 = /* @__PURE__ */ dual((args2) => isLayer(args2[0]), function() {
    const args2 = arguments;
    return fiberRefLocallyWith2(args2[0], currentTracerSpanAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations2) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations2));
  });
  withParentSpan2 = /* @__PURE__ */ dual(2, (self, span2) => provide(self, succeedContext(make6(spanTag, span2))));
  provideSomeLayer = /* @__PURE__ */ dual(2, (self, layer) => scopedWith((scope3) => flatMap7(buildWithScope(layer, scope3), (context3) => provideSomeContext(self, context3))));
  provideSomeRuntime = /* @__PURE__ */ dual(2, (self, rt) => {
    const patchRefs = diff9(defaultRuntime.fiberRefs, rt.fiberRefs);
    const patchFlags = diff7(defaultRuntime.runtimeFlags, rt.runtimeFlags);
    return uninterruptibleMask((restore) => withFiberRuntime((fiber) => {
      const oldContext = fiber.getFiberRef(currentContext);
      const oldRefs = fiber.getFiberRefs();
      const newRefs = patch10(fiber.id(), oldRefs)(patchRefs);
      const oldFlags = fiber.currentRuntimeFlags;
      const newFlags = patch7(patchFlags)(oldFlags);
      const rollbackRefs = diff9(newRefs, oldRefs);
      const rollbackFlags = diff7(newFlags, oldFlags);
      fiber.setFiberRefs(newRefs);
      fiber.currentRuntimeFlags = newFlags;
      return ensuring(provideSomeContext(restore(self), merge3(oldContext, rt.context)), withFiberRuntime((fiber2) => {
        fiber2.setFiberRefs(patch10(fiber2.id(), fiber2.getFiberRefs())(rollbackRefs));
        fiber2.currentRuntimeFlags = patch7(rollbackFlags)(fiber2.currentRuntimeFlags);
        return void_;
      }));
    }));
  });
  effect_provide = /* @__PURE__ */ dual(2, (self, source) => {
    if (Array.isArray(source)) {
      return provideSomeLayer(self, mergeAll4(...source));
    } else if (isLayer(source)) {
      return provideSomeLayer(self, source);
    } else if (isContext2(source)) {
      return provideSomeContext(self, source);
    } else if (TypeId18 in source) {
      return flatMap7(source.runtimeEffect, (rt) => provideSomeRuntime(self, rt));
    } else {
      return provideSomeRuntime(self, source);
    }
  });
});

// node_modules/effect/dist/esm/internal/console.js
var console2, consoleWith = (f) => fiberRefGetWith(currentServices, (services) => f(get3(services, consoleTag))), withConsole, withConsoleScoped = (console3) => fiberRefLocallyScopedWith(currentServices, add2(consoleTag, console3));
var init_console2 = __esm(() => {
  init_Context();
  init_Function();
  init_core();
  init_defaultServices();
  init_console();
  init_fiberRuntime();
  init_layer();
  console2 = /* @__PURE__ */ map9(/* @__PURE__ */ fiberRefGet(currentServices), /* @__PURE__ */ get3(consoleTag));
  withConsole = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(effect, currentServices, add2(consoleTag, value)));
});

// node_modules/effect/dist/esm/internal/query.js
var currentCache, currentCacheEnabled, fromRequest = (request, dataSource) => flatMap7(isEffect(dataSource) ? dataSource : succeed(dataSource), (ds) => fiberIdWith((id2) => {
  const proxy = new Proxy(request, {});
  return fiberRefGetWith(currentCacheEnabled, (cacheEnabled) => {
    if (cacheEnabled) {
      const cached3 = fiberRefGetWith(currentCache, (cache) => flatMap7(cache.getEither(proxy), (orNew) => {
        switch (orNew._tag) {
          case "Left": {
            if (orNew.left.listeners.interrupted) {
              return flatMap7(cache.invalidateWhen(proxy, (entry) => entry.handle === orNew.left.handle), () => cached3);
            }
            orNew.left.listeners.increment();
            return uninterruptibleMask((restore) => flatMap7(exit(blocked(empty19, restore(deferredAwait(orNew.left.handle)))), (exit2) => {
              orNew.left.listeners.decrement();
              return exit2;
            }));
          }
          case "Right": {
            orNew.right.listeners.increment();
            return uninterruptibleMask((restore) => flatMap7(exit(blocked(single(ds, makeEntry({
              request: proxy,
              result: orNew.right.handle,
              listeners: orNew.right.listeners,
              ownerId: id2,
              state: {
                completed: false
              }
            })), restore(deferredAwait(orNew.right.handle)))), () => {
              orNew.right.listeners.decrement();
              return deferredAwait(orNew.right.handle);
            }));
          }
        }
      }));
      return cached3;
    }
    const listeners = new Listeners;
    listeners.increment();
    return flatMap7(deferredMake(), (ref) => ensuring(blocked(single(ds, makeEntry({
      request: proxy,
      result: ref,
      listeners,
      ownerId: id2,
      state: {
        completed: false
      }
    })), deferredAwait(ref)), sync(() => listeners.decrement())));
  });
})), cacheRequest = (request, result) => {
  return fiberRefGetWith(currentCacheEnabled, (cacheEnabled) => {
    if (cacheEnabled) {
      return fiberRefGetWith(currentCache, (cache) => flatMap7(cache.getEither(request), (orNew) => {
        switch (orNew._tag) {
          case "Left": {
            return void_;
          }
          case "Right": {
            return deferredComplete(orNew.right.handle, result);
          }
        }
      }));
    }
    return void_;
  });
}, withRequestCaching, withRequestCache;
var init_query = __esm(() => {
  init_Duration();
  init_Function();
  init_GlobalValue();
  init_blockedRequests();
  init_cache();
  init_core();
  init_fiberRuntime();
  init_request();
  currentCache = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentCache"), () => fiberRefUnsafeMake(unsafeMakeWith(65536, () => map9(deferredMake(), (handle) => ({
    listeners: new Listeners,
    handle
  })), () => seconds(60))));
  currentCacheEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentCacheEnabled"), () => fiberRefUnsafeMake(false));
  withRequestCaching = /* @__PURE__ */ dual(2, (self, strategy) => fiberRefLocally(self, currentCacheEnabled, strategy));
  withRequestCache = /* @__PURE__ */ dual(2, (self, cache) => fiberRefLocally(self, currentCache, cache));
});

// node_modules/effect/dist/esm/Request.js
var isRequest2;
var init_Request = __esm(() => {
  init_blockedRequests();
  init_cache();
  init_core();
  init_fiberRuntime();
  init_request();
  isRequest2 = isRequest;
});

// node_modules/effect/dist/esm/Effect.js
var exports_Effect = {};
__export(exports_Effect, {
  zipWith: () => zipWith6,
  zipRight: () => zipRight2,
  zipLeft: () => zipLeft2,
  zip: () => zip4,
  yieldNow: () => yieldNow4,
  withUnhandledErrorLogLevel: () => withUnhandledErrorLogLevel2,
  withTracerTiming: () => withTracerTiming2,
  withTracerScoped: () => withTracerScoped2,
  withTracerEnabled: () => withTracerEnabled2,
  withTracer: () => withTracer2,
  withSpanScoped: () => withSpanScoped2,
  withSpan: () => withSpan3,
  withSchedulingPriority: () => withSchedulingPriority2,
  withScheduler: () => withScheduler2,
  withRuntimeFlagsPatchScoped: () => withRuntimeFlagsPatchScoped,
  withRuntimeFlagsPatch: () => withRuntimeFlagsPatch,
  withRequestCaching: () => withRequestCaching2,
  withRequestCache: () => withRequestCache2,
  withRequestBatching: () => withRequestBatching2,
  withRandomScoped: () => withRandomScoped2,
  withRandom: () => withRandom2,
  withParentSpan: () => withParentSpan3,
  withMetric: () => withMetric2,
  withMaxOpsBeforeYield: () => withMaxOpsBeforeYield2,
  withLogSpan: () => withLogSpan2,
  withFiberRuntime: () => withFiberRuntime2,
  withEarlyRelease: () => withEarlyRelease2,
  withConsoleScoped: () => withConsoleScoped2,
  withConsole: () => withConsole2,
  withConfigProviderScoped: () => withConfigProviderScoped2,
  withConfigProvider: () => withConfigProvider2,
  withConcurrency: () => withConcurrency2,
  withClockScoped: () => withClockScoped2,
  withClock: () => withClock2,
  whileLoop: () => whileLoop2,
  whenRef: () => whenRef2,
  whenLogLevel: () => whenLogLevel2,
  whenFiberRef: () => whenFiberRef2,
  whenEffect: () => whenEffect2,
  when: () => when2,
  void: () => _void,
  validateWith: () => validateWith2,
  validateFirst: () => validateFirst2,
  validateAll: () => validateAll2,
  validate: () => validate2,
  using: () => using2,
  useSpan: () => useSpan2,
  updateService: () => updateService2,
  updateFiberRefs: () => updateFiberRefs2,
  unsandbox: () => unsandbox2,
  unsafeMakeSemaphore: () => unsafeMakeSemaphore2,
  unsafeMakeLatch: () => unsafeMakeLatch2,
  unlessEffect: () => unlessEffect2,
  unless: () => unless2,
  uninterruptibleMask: () => uninterruptibleMask3,
  uninterruptible: () => uninterruptible2,
  tryPromise: () => tryPromise2,
  tryMapPromise: () => tryMapPromise2,
  tryMap: () => tryMap2,
  try: () => try_2,
  transposeOption: () => transposeOption,
  transposeMapOption: () => transposeMapOption,
  transplant: () => transplant2,
  tracerWith: () => tracerWith4,
  tracer: () => tracer2,
  timeoutTo: () => timeoutTo2,
  timeoutOption: () => timeoutOption2,
  timeoutFailCause: () => timeoutFailCause2,
  timeoutFail: () => timeoutFail2,
  timeout: () => timeout2,
  timedWith: () => timedWith2,
  timed: () => timed2,
  tapErrorTag: () => tapErrorTag2,
  tapErrorCause: () => tapErrorCause3,
  tapError: () => tapError3,
  tapDefect: () => tapDefect2,
  tapBoth: () => tapBoth2,
  tap: () => tap3,
  takeWhile: () => takeWhile2,
  takeUntil: () => takeUntil2,
  tagMetricsScoped: () => tagMetricsScoped2,
  tagMetrics: () => tagMetrics2,
  sync: () => sync3,
  suspend: () => suspend3,
  supervised: () => supervised2,
  summarized: () => summarized2,
  succeedSome: () => succeedSome2,
  succeedNone: () => succeedNone2,
  succeed: () => succeed7,
  step: () => step3,
  spanLinks: () => spanLinks2,
  spanAnnotations: () => spanAnnotations2,
  sleep: () => sleep4,
  setFiberRefs: () => setFiberRefs2,
  serviceOptional: () => serviceOptional2,
  serviceOption: () => serviceOption2,
  serviceMembers: () => serviceMembers2,
  serviceFunctions: () => serviceFunctions2,
  serviceFunctionEffect: () => serviceFunctionEffect2,
  serviceFunction: () => serviceFunction2,
  serviceConstants: () => serviceConstants2,
  sequentialFinalizers: () => sequentialFinalizers2,
  scopedWith: () => scopedWith2,
  scoped: () => scoped2,
  scopeWith: () => scopeWith2,
  scope: () => scope3,
  scheduleFrom: () => scheduleFrom,
  scheduleForked: () => scheduleForked2,
  schedule: () => schedule,
  sandbox: () => sandbox2,
  runtime: () => runtime3,
  runSyncExit: () => runSyncExit,
  runSync: () => runSync,
  runRequestBlock: () => runRequestBlock2,
  runPromiseExit: () => runPromiseExit,
  runPromise: () => runPromise,
  runFork: () => runFork2,
  runCallback: () => runCallback,
  retryOrElse: () => retryOrElse,
  retry: () => retry2,
  request: () => request,
  replicateEffect: () => replicateEffect2,
  replicate: () => replicate2,
  repeatOrElse: () => repeatOrElse,
  repeatN: () => repeatN2,
  repeat: () => repeat,
  reduceWhile: () => reduceWhile2,
  reduceRight: () => reduceRight3,
  reduceEffect: () => reduceEffect2,
  reduce: () => reduce11,
  randomWith: () => randomWith2,
  random: () => random3,
  raceWith: () => raceWith2,
  raceFirst: () => raceFirst2,
  raceAll: () => raceAll2,
  race: () => race2,
  provideServiceEffect: () => provideServiceEffect2,
  provideService: () => provideService2,
  provide: () => provide2,
  promise: () => promise2,
  patchRuntimeFlags: () => patchRuntimeFlags,
  patchFiberRefs: () => patchFiberRefs2,
  partition: () => partition4,
  parallelFinalizers: () => parallelFinalizers2,
  parallelErrors: () => parallelErrors2,
  orElseSucceed: () => orElseSucceed2,
  orElseFail: () => orElseFail2,
  orElse: () => orElse5,
  orDieWith: () => orDieWith2,
  orDie: () => orDie3,
  optionFromOptional: () => optionFromOptional2,
  option: () => option2,
  once: () => once2,
  onInterrupt: () => onInterrupt2,
  onExit: () => onExit3,
  onError: () => onError2,
  none: () => none9,
  never: () => never3,
  negate: () => negate2,
  metricLabels: () => metricLabels2,
  mergeAll: () => mergeAll5,
  merge: () => merge7,
  matchEffect: () => matchEffect2,
  matchCauseEffect: () => matchCauseEffect3,
  matchCause: () => matchCause3,
  match: () => match13,
  mapInputContext: () => mapInputContext2,
  mapErrorCause: () => mapErrorCause2,
  mapError: () => mapError3,
  mapBoth: () => mapBoth2,
  mapAccum: () => mapAccum3,
  map: () => map13,
  makeSpanScoped: () => makeSpanScoped2,
  makeSpan: () => makeSpan2,
  makeSemaphore: () => makeSemaphore2,
  makeLatch: () => makeLatch2,
  loop: () => loop2,
  logWithLevel: () => logWithLevel2,
  logWarning: () => logWarning2,
  logTrace: () => logTrace2,
  logInfo: () => logInfo2,
  logFatal: () => logFatal2,
  logError: () => logError2,
  logDebug: () => logDebug2,
  logAnnotations: () => logAnnotations2,
  log: () => log2,
  locallyWith: () => locallyWith,
  locallyScopedWith: () => locallyScopedWith,
  locallyScoped: () => locallyScoped,
  locally: () => locally,
  linkSpans: () => linkSpans2,
  linkSpanCurrent: () => linkSpanCurrent2,
  liftPredicate: () => liftPredicate2,
  let: () => let_3,
  labelMetricsScoped: () => labelMetricsScoped2,
  labelMetrics: () => labelMetrics2,
  iterate: () => iterate2,
  isSuccess: () => isSuccess3,
  isFailure: () => isFailure3,
  isEffect: () => isEffect2,
  intoDeferred: () => intoDeferred2,
  interruptibleMask: () => interruptibleMask2,
  interruptible: () => interruptible4,
  interruptWith: () => interruptWith2,
  interrupt: () => interrupt6,
  inheritFiberRefs: () => inheritFiberRefs2,
  ignoreLogged: () => ignoreLogged2,
  ignore: () => ignore2,
  if: () => if_2,
  head: () => head4,
  getRuntimeFlags: () => getRuntimeFlags,
  getFiberRefs: () => getFiberRefs,
  gen: () => gen2,
  functionWithSpan: () => functionWithSpan2,
  fromNullable: () => fromNullable3,
  fromFiberEffect: () => fromFiberEffect2,
  fromFiber: () => fromFiber2,
  forkWithErrorHandler: () => forkWithErrorHandler2,
  forkScoped: () => forkScoped2,
  forkIn: () => forkIn2,
  forkDaemon: () => forkDaemon2,
  forkAll: () => forkAll2,
  fork: () => fork3,
  forever: () => forever3,
  forEach: () => forEach8,
  fnUntraced: () => fnUntraced2,
  fn: () => fn,
  flipWith: () => flipWith2,
  flip: () => flip2,
  flatten: () => flatten8,
  flatMap: () => flatMap10,
  firstSuccessOf: () => firstSuccessOf2,
  findFirst: () => findFirst6,
  finalizersMask: () => finalizersMask2,
  filterOrFail: () => filterOrFail2,
  filterOrElse: () => filterOrElse2,
  filterOrDieMessage: () => filterOrDieMessage2,
  filterOrDie: () => filterOrDie2,
  filterMap: () => filterMap4,
  filterEffectOrFail: () => filterEffectOrFail2,
  filterEffectOrElse: () => filterEffectOrElse2,
  filter: () => filter7,
  fiberIdWith: () => fiberIdWith2,
  fiberId: () => fiberId2,
  failSync: () => failSync3,
  failCauseSync: () => failCauseSync3,
  failCause: () => failCause7,
  fail: () => fail8,
  exit: () => exit2,
  exists: () => exists3,
  every: () => every6,
  eventually: () => eventually2,
  ensuringChildren: () => ensuringChildren2,
  ensuringChild: () => ensuringChild2,
  ensuring: () => ensuring2,
  either: () => either3,
  dropWhile: () => dropWhile2,
  dropUntil: () => dropUntil2,
  disconnect: () => disconnect2,
  diffFiberRefs: () => diffFiberRefs2,
  dieSync: () => dieSync3,
  dieMessage: () => dieMessage2,
  die: () => die6,
  descriptorWith: () => descriptorWith2,
  descriptor: () => descriptor2,
  delay: () => delay2,
  daemonChildren: () => daemonChildren2,
  custom: () => custom2,
  currentSpan: () => currentSpan2,
  currentParentSpan: () => currentParentSpan2,
  contextWithEffect: () => contextWithEffect2,
  contextWith: () => contextWith2,
  context: () => context3,
  consoleWith: () => consoleWith2,
  console: () => console3,
  configProviderWith: () => configProviderWith2,
  clockWith: () => clockWith4,
  clock: () => clock2,
  checkInterruptible: () => checkInterruptible2,
  cause: () => cause2,
  catchTags: () => catchTags2,
  catchTag: () => catchTag2,
  catchSomeDefect: () => catchSomeDefect2,
  catchSomeCause: () => catchSomeCause2,
  catchSome: () => catchSome2,
  catchIf: () => catchIf2,
  catchAllDefect: () => catchAllDefect2,
  catchAllCause: () => catchAllCause3,
  catchAll: () => catchAll3,
  catch: () => _catch2,
  cachedWithTTL: () => cachedWithTTL,
  cachedInvalidateWithTTL: () => cachedInvalidateWithTTL2,
  cachedFunction: () => cachedFunction2,
  cached: () => cached3,
  cacheRequestResult: () => cacheRequestResult,
  blocked: () => blocked2,
  bindTo: () => bindTo3,
  bindAll: () => bindAll2,
  bind: () => bind3,
  awaitAllChildren: () => awaitAllChildren2,
  asyncEffect: () => asyncEffect2,
  async: () => async,
  asVoid: () => asVoid2,
  asSomeError: () => asSomeError2,
  asSome: () => asSome2,
  as: () => as3,
  ap: () => ap,
  annotateSpans: () => annotateSpans3,
  annotateLogsScoped: () => annotateLogsScoped2,
  annotateLogs: () => annotateLogs3,
  annotateCurrentSpan: () => annotateCurrentSpan2,
  andThen: () => andThen4,
  allowInterrupt: () => allowInterrupt2,
  allWith: () => allWith2,
  allSuccesses: () => allSuccesses2,
  all: () => all4,
  addFinalizer: () => addFinalizer2,
  acquireUseRelease: () => acquireUseRelease2,
  acquireReleaseInterruptible: () => acquireReleaseInterruptible2,
  acquireRelease: () => acquireRelease2,
  Tag: () => Tag3,
  Service: () => Service,
  EffectTypeId: () => EffectTypeId3,
  Do: () => Do2
});
function defineLength(length2, fn2) {
  return Object.defineProperty(fn2, "length", {
    value: length2,
    configurable: true
  });
}
function fnApply(options) {
  let effect;
  let fnError = undefined;
  if (isGeneratorFunction(options.body)) {
    effect = fromIterator(() => options.body.apply(options.self, options.args));
  } else {
    try {
      effect = options.body.apply(options.self, options.args);
    } catch (error) {
      fnError = error;
      effect = die6(error);
    }
  }
  if (options.pipeables.length > 0) {
    try {
      for (const x of options.pipeables) {
        effect = x(effect, ...options.args);
      }
    } catch (error) {
      effect = fnError ? failCause7(sequential(die(fnError), die(error))) : die6(error);
    }
  }
  let cache = false;
  const captureStackTrace = () => {
    if (cache !== false) {
      return cache;
    }
    if (options.errorCall.stack) {
      const stackDef = options.errorDef.stack.trim().split(`
`);
      const stackCall = options.errorCall.stack.trim().split(`
`);
      cache = `${stackDef.slice(2).join(`
`).trim()}
${stackCall.slice(2).join(`
`).trim()}`;
      return cache;
    }
  };
  const opts = options.spanOptions && "captureStackTrace" in options.spanOptions ? options.spanOptions : {
    captureStackTrace,
    ...options.spanOptions
  };
  return withSpan3(effect, options.spanName, opts);
}
var EffectTypeId3, isEffect2, cachedWithTTL, cachedInvalidateWithTTL2, cached3, cachedFunction2, once2, all4, allWith2, allSuccesses2, dropUntil2, dropWhile2, takeUntil2, takeWhile2, every6, exists3, filter7, filterMap4, findFirst6, forEach8, head4, mergeAll5, partition4, reduce11, reduceWhile2, reduceRight3, reduceEffect2, replicate2, replicateEffect2, validateAll2, validateFirst2, async, asyncEffect2, custom2, withFiberRuntime2, fail8, failSync3, failCause7, failCauseSync3, die6, dieMessage2, dieSync3, gen2, never3, none9, promise2, succeed7, succeedNone2, succeedSome2, suspend3, sync3, _void, yieldNow4, _catch2, catchAll3, catchAllCause3, catchAllDefect2, catchIf2, catchSome2, catchSomeCause2, catchSomeDefect2, catchTag2, catchTags2, cause2, eventually2, ignore2, ignoreLogged2, parallelErrors2, sandbox2, retry2, retryOrElse, try_2, tryMap2, tryMapPromise2, tryPromise2, unsandbox2, allowInterrupt2, checkInterruptible2, disconnect2, interrupt6, interruptWith2, interruptible4, interruptibleMask2, onInterrupt2, uninterruptible2, uninterruptibleMask3, liftPredicate2, as3, asSome2, asSomeError2, asVoid2, flip2, flipWith2, map13, mapAccum3, mapBoth2, mapError3, mapErrorCause2, merge7, negate2, acquireRelease2, acquireReleaseInterruptible2, acquireUseRelease2, addFinalizer2, ensuring2, onError2, onExit3, parallelFinalizers2, sequentialFinalizers2, finalizersMask2, scope3, scopeWith2, scopedWith2, scoped2, using2, withEarlyRelease2, awaitAllChildren2, daemonChildren2, descriptor2, descriptorWith2, diffFiberRefs2, ensuringChild2, ensuringChildren2, fiberId2, fiberIdWith2, fork3, forkDaemon2, forkAll2, forkIn2, forkScoped2, forkWithErrorHandler2, fromFiber2, fromFiberEffect2, supervised2, transplant2, withConcurrency2, withScheduler2, withSchedulingPriority2, withMaxOpsBeforeYield2, clock2, clockWith4, withClockScoped2, withClock2, console3, consoleWith2, withConsoleScoped2, withConsole2, delay2, sleep4, timed2, timedWith2, timeout2, timeoutOption2, timeoutFail2, timeoutFailCause2, timeoutTo2, configProviderWith2, withConfigProvider2, withConfigProviderScoped2, context3, contextWith2, contextWithEffect2, mapInputContext2, provide2, provideService2, provideServiceEffect2, serviceFunction2, serviceFunctionEffect2, serviceFunctions2, serviceConstants2, serviceMembers2, serviceOption2, serviceOptional2, updateService2, Do2, bind3, bindAll2, bindTo3, let_3, option2, either3, exit2, intoDeferred2, if_2, filterOrDie2, filterOrDieMessage2, filterOrElse2, filterOrFail2, filterEffectOrElse2, filterEffectOrFail2, unless2, unlessEffect2, when2, whenEffect2, whenFiberRef2, whenRef2, flatMap10, andThen4, flatten8, race2, raceAll2, raceFirst2, raceWith2, summarized2, tap3, tapBoth2, tapDefect2, tapError3, tapErrorTag2, tapErrorCause3, forever3, iterate2, loop2, repeat, repeatN2, repeatOrElse, schedule, scheduleForked2, scheduleFrom, whileLoop2, getFiberRefs, inheritFiberRefs2, locally, locallyWith, locallyScoped, locallyScopedWith, patchFiberRefs2, setFiberRefs2, updateFiberRefs2, isFailure3, isSuccess3, match13, matchCause3, matchCauseEffect3, matchEffect2, log2, logWithLevel2 = (level, ...message) => logWithLevel(level)(...message), logTrace2, logDebug2, logInfo2, logWarning2, logError2, logFatal2, withLogSpan2, annotateLogs3, annotateLogsScoped2, logAnnotations2, withUnhandledErrorLogLevel2, whenLogLevel2, orDie3, orDieWith2, orElse5, orElseFail2, orElseSucceed2, firstSuccessOf2, random3, randomWith2, withRandom2, withRandomScoped2, runtime3, getRuntimeFlags, patchRuntimeFlags, withRuntimeFlagsPatch, withRuntimeFlagsPatchScoped, tagMetrics2, labelMetrics2, tagMetricsScoped2, labelMetricsScoped2, metricLabels2, withMetric2, unsafeMakeSemaphore2, makeSemaphore2, unsafeMakeLatch2, makeLatch2, runFork2, runCallback, runPromise, runPromiseExit, runSync, runSyncExit, validate2, validateWith2, zip4, zipLeft2, zipRight2, zipWith6, ap, blocked2, runRequestBlock2, step3, request, cacheRequestResult, withRequestBatching2, withRequestCaching2, withRequestCache2, tracer2, tracerWith4, withTracer2, withTracerScoped2, withTracerEnabled2, withTracerTiming2, annotateSpans3, annotateCurrentSpan2, currentSpan2, currentParentSpan2, spanAnnotations2, spanLinks2, linkSpans2, linkSpanCurrent2, makeSpan2, makeSpanScoped2, useSpan2, withSpan3, functionWithSpan2, withSpanScoped2, withParentSpan3, fromNullable3, optionFromOptional2, transposeOption = (self) => {
  return isNone(self) ? succeedNone2 : map13(self.value, some);
}, transposeMapOption, makeTagProxy = (TagClass) => {
  const cache = new Map;
  return new Proxy(TagClass, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      if (cache.has(prop)) {
        return cache.get(prop);
      }
      const fn = (...args2) => andThen2(target, (s) => {
        if (typeof s[prop] === "function") {
          cache.set(prop, (...args3) => andThen2(target, (s2) => s2[prop](...args3)));
          return s[prop](...args2);
        }
        cache.set(prop, andThen2(target, (s2) => s2[prop]));
        return s[prop];
      });
      const cn = andThen2(target, (s) => s[prop]);
      Object.assign(fn, cn);
      Object.setPrototypeOf(fn, Object.getPrototypeOf(cn));
      cache.set(prop, fn);
      return fn;
    }
  });
}, Tag3 = (id2) => () => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  function TagClass() {}
  Object.setPrototypeOf(TagClass, TagProto);
  TagClass.key = id2;
  Object.defineProperty(TagClass, "use", {
    get() {
      return (body) => andThen2(this, body);
    }
  });
  Object.defineProperty(TagClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return makeTagProxy(TagClass);
}, Service = function() {
  return function() {
    const [id2, maker] = arguments;
    const proxy = "accessors" in maker ? maker["accessors"] : false;
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const creationError = new Error;
    Error.stackTraceLimit = limit;
    let patchState = "unchecked";
    const TagClass = function(service2) {
      if (patchState === "unchecked") {
        const proto4 = Object.getPrototypeOf(service2);
        if (proto4 === Object.prototype || proto4 === null) {
          patchState = "plain";
        } else {
          const selfProto = Object.getPrototypeOf(this);
          Object.setPrototypeOf(selfProto, proto4);
          patchState = "patched";
        }
      }
      if (patchState === "plain") {
        Object.assign(this, service2);
      } else if (patchState === "patched") {
        Object.setPrototypeOf(service2, Object.getPrototypeOf(this));
        return service2;
      }
    };
    TagClass.prototype._tag = id2;
    Object.defineProperty(TagClass, "make", {
      get() {
        return (service2) => new this(service2);
      }
    });
    Object.defineProperty(TagClass, "use", {
      get() {
        return (body) => andThen2(this, body);
      }
    });
    TagClass.key = id2;
    Object.assign(TagClass, TagProto);
    Object.defineProperty(TagClass, "stack", {
      get() {
        return creationError.stack;
      }
    });
    const hasDeps = "dependencies" in maker && maker.dependencies.length > 0;
    const layerName = hasDeps ? "DefaultWithoutDependencies" : "Default";
    let layerCache;
    if ("effect" in maker) {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= fromEffect3(TagClass, map13(maker.effect, (_) => new this(_)));
        }
      });
    } else if ("scoped" in maker) {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= scoped(TagClass, map13(maker.scoped, (_) => new this(_)));
        }
      });
    } else if ("sync" in maker) {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= sync2(TagClass, () => new this(maker.sync()));
        }
      });
    } else {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= succeed5(TagClass, new this(maker.succeed));
        }
      });
    }
    if (hasDeps) {
      let layerWithDepsCache;
      Object.defineProperty(TagClass, "Default", {
        get() {
          return layerWithDepsCache ??= provide(this.DefaultWithoutDependencies, maker.dependencies);
        }
      });
    }
    return proxy === true ? makeTagProxy(TagClass) : TagClass;
  };
}, fn = function(nameOrBody, ...pipeables) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const errorDef = new Error;
  Error.stackTraceLimit = limit;
  if (typeof nameOrBody !== "string") {
    return defineLength(nameOrBody.length, function(...args2) {
      const limit2 = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      const errorCall = new Error;
      Error.stackTraceLimit = limit2;
      return fnApply({
        self: this,
        body: nameOrBody,
        args: args2,
        pipeables,
        spanName: "<anonymous>",
        spanOptions: {
          context: DisablePropagation.context(true)
        },
        errorDef,
        errorCall
      });
    });
  }
  const name = nameOrBody;
  const options = pipeables[0];
  return (body, ...pipeables2) => defineLength(body.length, function(...args2) {
    const limit2 = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const errorCall = new Error;
    Error.stackTraceLimit = limit2;
    return fnApply({
      self: this,
      body,
      args: args2,
      pipeables: pipeables2,
      spanName: name,
      spanOptions: options,
      errorDef,
      errorCall
    });
  });
}, fnUntraced2;
var init_Effect = __esm(() => {
  init_Function();
  init_cause();
  init_console2();
  init_context();
  init_core_effect();
  init_core();
  init_defaultServices();
  init_circular();
  init_fiberRuntime();
  init_layer();
  init_option();
  init_query();
  init_runtime();
  init_schedule();
  init_tracer();
  init_Request();
  init_Scheduler();
  init_Utils();
  EffectTypeId3 = EffectTypeId2;
  isEffect2 = isEffect;
  cachedWithTTL = cached2;
  cachedInvalidateWithTTL2 = cachedInvalidateWithTTL;
  cached3 = memoize;
  cachedFunction2 = cachedFunction;
  once2 = once;
  all4 = all2;
  allWith2 = allWith;
  allSuccesses2 = allSuccesses;
  dropUntil2 = dropUntil;
  dropWhile2 = dropWhile;
  takeUntil2 = takeUntil;
  takeWhile2 = takeWhile;
  every6 = every5;
  exists3 = exists2;
  filter7 = filter4;
  filterMap4 = filterMap3;
  findFirst6 = findFirst4;
  forEach8 = forEach7;
  head4 = head3;
  mergeAll5 = mergeAll3;
  partition4 = partition3;
  reduce11 = reduce9;
  reduceWhile2 = reduceWhile;
  reduceRight3 = reduceRight2;
  reduceEffect2 = reduceEffect;
  replicate2 = replicate;
  replicateEffect2 = replicateEffect;
  validateAll2 = validateAll;
  validateFirst2 = validateFirst;
  async = async_;
  asyncEffect2 = asyncEffect;
  custom2 = custom;
  withFiberRuntime2 = withFiberRuntime;
  fail8 = fail2;
  failSync3 = failSync;
  failCause7 = failCause;
  failCauseSync3 = failCauseSync;
  die6 = die2;
  dieMessage2 = dieMessage;
  dieSync3 = dieSync;
  gen2 = gen;
  never3 = never;
  none9 = none6;
  promise2 = promise;
  succeed7 = succeed;
  succeedNone2 = succeedNone;
  succeedSome2 = succeedSome;
  suspend3 = suspend;
  sync3 = sync;
  _void = void_;
  yieldNow4 = yieldNow;
  _catch2 = _catch;
  catchAll3 = catchAll;
  catchAllCause3 = catchAllCause;
  catchAllDefect2 = catchAllDefect;
  catchIf2 = catchIf;
  catchSome2 = catchSome;
  catchSomeCause2 = catchSomeCause;
  catchSomeDefect2 = catchSomeDefect;
  catchTag2 = catchTag;
  catchTags2 = catchTags;
  cause2 = cause;
  eventually2 = eventually;
  ignore2 = ignore;
  ignoreLogged2 = ignoreLogged;
  parallelErrors2 = parallelErrors;
  sandbox2 = sandbox;
  retry2 = retry_combined;
  retryOrElse = retryOrElse_Effect;
  try_2 = try_;
  tryMap2 = tryMap;
  tryMapPromise2 = tryMapPromise;
  tryPromise2 = tryPromise;
  unsandbox2 = unsandbox;
  allowInterrupt2 = allowInterrupt;
  checkInterruptible2 = checkInterruptible;
  disconnect2 = disconnect;
  interrupt6 = interrupt2;
  interruptWith2 = interruptWith;
  interruptible4 = interruptible2;
  interruptibleMask2 = interruptibleMask;
  onInterrupt2 = onInterrupt;
  uninterruptible2 = uninterruptible;
  uninterruptibleMask3 = uninterruptibleMask;
  liftPredicate2 = liftPredicate;
  as3 = as;
  asSome2 = asSome;
  asSomeError2 = asSomeError;
  asVoid2 = asVoid;
  flip2 = flip;
  flipWith2 = flipWith;
  map13 = map9;
  mapAccum3 = mapAccum2;
  mapBoth2 = mapBoth;
  mapError3 = mapError;
  mapErrorCause2 = mapErrorCause;
  merge7 = merge5;
  negate2 = negate;
  acquireRelease2 = acquireRelease;
  acquireReleaseInterruptible2 = acquireReleaseInterruptible;
  acquireUseRelease2 = acquireUseRelease;
  addFinalizer2 = addFinalizer;
  ensuring2 = ensuring;
  onError2 = onError;
  onExit3 = onExit;
  parallelFinalizers2 = parallelFinalizers;
  sequentialFinalizers2 = sequentialFinalizers;
  finalizersMask2 = finalizersMask;
  scope3 = scope;
  scopeWith2 = scopeWith;
  scopedWith2 = scopedWith;
  scoped2 = scopedEffect;
  using2 = using;
  withEarlyRelease2 = withEarlyRelease;
  awaitAllChildren2 = awaitAllChildren;
  daemonChildren2 = daemonChildren;
  descriptor2 = descriptor;
  descriptorWith2 = descriptorWith;
  diffFiberRefs2 = diffFiberRefs;
  ensuringChild2 = ensuringChild;
  ensuringChildren2 = ensuringChildren;
  fiberId2 = fiberId;
  fiberIdWith2 = fiberIdWith;
  fork3 = fork;
  forkDaemon2 = forkDaemon;
  forkAll2 = forkAll;
  forkIn2 = forkIn;
  forkScoped2 = forkScoped;
  forkWithErrorHandler2 = forkWithErrorHandler;
  fromFiber2 = fromFiber;
  fromFiberEffect2 = fromFiberEffect;
  supervised2 = supervised;
  transplant2 = transplant;
  withConcurrency2 = withConcurrency;
  withScheduler2 = withScheduler;
  withSchedulingPriority2 = withSchedulingPriority;
  withMaxOpsBeforeYield2 = withMaxOpsBeforeYield;
  clock2 = clock;
  clockWith4 = clockWith3;
  withClockScoped2 = withClockScoped;
  withClock2 = withClock;
  console3 = console2;
  consoleWith2 = consoleWith;
  withConsoleScoped2 = withConsoleScoped;
  withConsole2 = withConsole;
  delay2 = delay;
  sleep4 = sleep3;
  timed2 = timed;
  timedWith2 = timedWith;
  timeout2 = timeout;
  timeoutOption2 = timeoutOption;
  timeoutFail2 = timeoutFail;
  timeoutFailCause2 = timeoutFailCause;
  timeoutTo2 = timeoutTo;
  configProviderWith2 = configProviderWith;
  withConfigProvider2 = withConfigProvider;
  withConfigProviderScoped2 = withConfigProviderScoped;
  context3 = context;
  contextWith2 = contextWith;
  contextWithEffect2 = contextWithEffect;
  mapInputContext2 = mapInputContext;
  provide2 = effect_provide;
  provideService2 = provideService;
  provideServiceEffect2 = provideServiceEffect;
  serviceFunction2 = serviceFunction;
  serviceFunctionEffect2 = serviceFunctionEffect;
  serviceFunctions2 = serviceFunctions;
  serviceConstants2 = serviceConstants;
  serviceMembers2 = serviceMembers;
  serviceOption2 = serviceOption;
  serviceOptional2 = serviceOptional;
  updateService2 = updateService;
  Do2 = Do;
  bind3 = bind2;
  bindAll2 = bindAll;
  bindTo3 = bindTo2;
  let_3 = let_2;
  option2 = option;
  either3 = either2;
  exit2 = exit;
  intoDeferred2 = intoDeferred;
  if_2 = if_;
  filterOrDie2 = filterOrDie;
  filterOrDieMessage2 = filterOrDieMessage;
  filterOrElse2 = filterOrElse;
  filterOrFail2 = filterOrFail;
  filterEffectOrElse2 = filterEffectOrElse;
  filterEffectOrFail2 = filterEffectOrFail;
  unless2 = unless;
  unlessEffect2 = unlessEffect;
  when2 = when;
  whenEffect2 = whenEffect;
  whenFiberRef2 = whenFiberRef;
  whenRef2 = whenRef;
  flatMap10 = flatMap7;
  andThen4 = andThen2;
  flatten8 = flatten5;
  race2 = race;
  raceAll2 = raceAll;
  raceFirst2 = raceFirst;
  raceWith2 = raceWith;
  summarized2 = summarized;
  tap3 = tap;
  tapBoth2 = tapBoth;
  tapDefect2 = tapDefect;
  tapError3 = tapError;
  tapErrorTag2 = tapErrorTag;
  tapErrorCause3 = tapErrorCause;
  forever3 = forever;
  iterate2 = iterate;
  loop2 = loop;
  repeat = repeat_combined;
  repeatN2 = repeatN;
  repeatOrElse = repeatOrElse_Effect;
  schedule = schedule_Effect;
  scheduleForked2 = scheduleForked;
  scheduleFrom = scheduleFrom_Effect;
  whileLoop2 = whileLoop;
  getFiberRefs = fiberRefs2;
  inheritFiberRefs2 = inheritFiberRefs;
  locally = fiberRefLocally;
  locallyWith = fiberRefLocallyWith;
  locallyScoped = fiberRefLocallyScoped;
  locallyScopedWith = fiberRefLocallyScopedWith;
  patchFiberRefs2 = patchFiberRefs;
  setFiberRefs2 = setFiberRefs;
  updateFiberRefs2 = updateFiberRefs;
  isFailure3 = isFailure;
  isSuccess3 = isSuccess2;
  match13 = match6;
  matchCause3 = matchCause;
  matchCauseEffect3 = matchCauseEffect;
  matchEffect2 = matchEffect;
  log2 = log;
  logTrace2 = logTrace;
  logDebug2 = logDebug;
  logInfo2 = logInfo;
  logWarning2 = logWarning;
  logError2 = logError;
  logFatal2 = logFatal;
  withLogSpan2 = withLogSpan;
  annotateLogs3 = annotateLogs;
  annotateLogsScoped2 = annotateLogsScoped;
  logAnnotations2 = logAnnotations;
  withUnhandledErrorLogLevel2 = withUnhandledErrorLogLevel;
  whenLogLevel2 = whenLogLevel;
  orDie3 = orDie;
  orDieWith2 = orDieWith;
  orElse5 = orElse2;
  orElseFail2 = orElseFail;
  orElseSucceed2 = orElseSucceed;
  firstSuccessOf2 = firstSuccessOf;
  random3 = random2;
  randomWith2 = randomWith;
  withRandom2 = withRandom;
  withRandomScoped2 = withRandomScoped;
  runtime3 = runtime2;
  getRuntimeFlags = runtimeFlags;
  patchRuntimeFlags = updateRuntimeFlags;
  withRuntimeFlagsPatch = withRuntimeFlags;
  withRuntimeFlagsPatchScoped = withRuntimeFlagsScoped;
  tagMetrics2 = tagMetrics;
  labelMetrics2 = labelMetrics;
  tagMetricsScoped2 = tagMetricsScoped;
  labelMetricsScoped2 = labelMetricsScoped;
  metricLabels2 = metricLabels;
  withMetric2 = withMetric;
  unsafeMakeSemaphore2 = unsafeMakeSemaphore;
  makeSemaphore2 = makeSemaphore;
  unsafeMakeLatch2 = unsafeMakeLatch;
  makeLatch2 = makeLatch;
  runFork2 = unsafeForkEffect;
  runCallback = unsafeRunEffect;
  runPromise = unsafeRunPromiseEffect;
  runPromiseExit = unsafeRunPromiseExitEffect;
  runSync = unsafeRunSyncEffect;
  runSyncExit = unsafeRunSyncExitEffect;
  validate2 = validate;
  validateWith2 = validateWith;
  zip4 = zipOptions;
  zipLeft2 = zipLeftOptions;
  zipRight2 = zipRightOptions;
  zipWith6 = zipWithOptions;
  ap = /* @__PURE__ */ dual(2, (self, that) => zipWith6(self, that, (f, a) => f(a)));
  blocked2 = blocked;
  runRequestBlock2 = runRequestBlock;
  step3 = step2;
  request = /* @__PURE__ */ dual((args2) => isRequest2(args2[0]), fromRequest);
  cacheRequestResult = cacheRequest;
  withRequestBatching2 = withRequestBatching;
  withRequestCaching2 = withRequestCaching;
  withRequestCache2 = withRequestCache;
  tracer2 = tracer;
  tracerWith4 = tracerWith;
  withTracer2 = withTracer;
  withTracerScoped2 = withTracerScoped;
  withTracerEnabled2 = withTracerEnabled;
  withTracerTiming2 = withTracerTiming;
  annotateSpans3 = annotateSpans;
  annotateCurrentSpan2 = annotateCurrentSpan;
  currentSpan2 = currentSpan;
  currentParentSpan2 = currentParentSpan;
  spanAnnotations2 = spanAnnotations;
  spanLinks2 = spanLinks;
  linkSpans2 = linkSpans;
  linkSpanCurrent2 = linkSpanCurrent;
  makeSpan2 = makeSpan;
  makeSpanScoped2 = makeSpanScoped;
  useSpan2 = useSpan;
  withSpan3 = withSpan;
  functionWithSpan2 = functionWithSpan;
  withSpanScoped2 = withSpanScoped;
  withParentSpan3 = withParentSpan;
  fromNullable3 = fromNullable2;
  optionFromOptional2 = optionFromOptional;
  transposeMapOption = /* @__PURE__ */ dual(2, (self, f) => isNone(self) ? succeedNone2 : map13(f(self.value), some));
  fnUntraced2 = fnUntraced;
});

// node_modules/effect/dist/esm/FiberRef.js
var exports_FiberRef = {};
__export(exports_FiberRef, {
  updateSomeAndGet: () => updateSomeAndGet2,
  updateSome: () => updateSome2,
  updateAndGet: () => updateAndGet2,
  update: () => update5,
  unsafeMakeSupervisor: () => unsafeMakeSupervisor,
  unsafeMakePatch: () => unsafeMakePatch,
  unsafeMakeHashSet: () => unsafeMakeHashSet,
  unsafeMakeContext: () => unsafeMakeContext,
  unsafeMake: () => unsafeMake9,
  unhandledErrorLogLevel: () => unhandledErrorLogLevel,
  set: () => set6,
  reset: () => reset,
  modifySome: () => modifySome2,
  modify: () => modify4,
  makeWith: () => makeWith2,
  makeRuntimeFlags: () => makeRuntimeFlags,
  makeContext: () => makeContext2,
  make: () => make41,
  interruptedCause: () => interruptedCause,
  getWith: () => getWith,
  getAndUpdateSome: () => getAndUpdateSome2,
  getAndUpdate: () => getAndUpdate2,
  getAndSet: () => getAndSet3,
  get: () => get13,
  delete: () => _delete,
  currentTracerTimingEnabled: () => currentTracerTimingEnabled2,
  currentTracerSpanLinks: () => currentTracerSpanLinks2,
  currentTracerSpanAnnotations: () => currentTracerSpanAnnotations2,
  currentTracerEnabled: () => currentTracerEnabled2,
  currentSupervisor: () => currentSupervisor2,
  currentSchedulingPriority: () => currentSchedulingPriority2,
  currentScheduler: () => currentScheduler2,
  currentRuntimeFlags: () => currentRuntimeFlags2,
  currentRequestCacheEnabled: () => currentRequestCacheEnabled,
  currentRequestCache: () => currentRequestCache,
  currentRequestBatchingEnabled: () => currentRequestBatchingEnabled,
  currentMinimumLogLevel: () => currentMinimumLogLevel2,
  currentMetricLabels: () => currentMetricLabels2,
  currentMaxOpsBeforeYield: () => currentMaxOpsBeforeYield2,
  currentLoggers: () => currentLoggers2,
  currentLogSpan: () => currentLogSpan2,
  currentLogLevel: () => currentLogLevel2,
  currentLogAnnotations: () => currentLogAnnotations2,
  currentContext: () => currentContext2,
  currentConcurrency: () => currentConcurrency2,
  FiberRefTypeId: () => FiberRefTypeId2
});
var FiberRefTypeId2, make41, makeWith2, makeContext2, makeRuntimeFlags, unsafeMake9, unsafeMakeHashSet, unsafeMakeContext, unsafeMakeSupervisor, unsafeMakePatch, get13, getAndSet3, getAndUpdate2, getAndUpdateSome2, getWith, set6, _delete, reset, modify4, modifySome2, update5, updateSome2, updateAndGet2, updateSomeAndGet2, currentConcurrency2, currentRequestBatchingEnabled, currentRequestCache, currentRequestCacheEnabled, currentContext2, currentSchedulingPriority2, currentMaxOpsBeforeYield2, unhandledErrorLogLevel, currentLogAnnotations2, currentLoggers2, currentLogLevel2, currentMinimumLogLevel2, currentLogSpan2, currentRuntimeFlags2, currentScheduler2, currentSupervisor2, currentMetricLabels2, currentTracerEnabled2, currentTracerTimingEnabled2, currentTracerSpanAnnotations2, currentTracerSpanLinks2, interruptedCause;
var init_FiberRef = __esm(() => {
  init_core();
  init_fiberRuntime();
  init_query();
  init_Scheduler();
  FiberRefTypeId2 = FiberRefTypeId;
  make41 = fiberRefMake;
  makeWith2 = fiberRefMakeWith;
  makeContext2 = fiberRefMakeContext;
  makeRuntimeFlags = fiberRefMakeRuntimeFlags;
  unsafeMake9 = fiberRefUnsafeMake;
  unsafeMakeHashSet = fiberRefUnsafeMakeHashSet;
  unsafeMakeContext = fiberRefUnsafeMakeContext;
  unsafeMakeSupervisor = fiberRefUnsafeMakeSupervisor;
  unsafeMakePatch = fiberRefUnsafeMakePatch;
  get13 = fiberRefGet;
  getAndSet3 = fiberRefGetAndSet;
  getAndUpdate2 = fiberRefGetAndUpdate;
  getAndUpdateSome2 = fiberRefGetAndUpdateSome;
  getWith = fiberRefGetWith;
  set6 = fiberRefSet;
  _delete = fiberRefDelete;
  reset = fiberRefReset;
  modify4 = fiberRefModify;
  modifySome2 = fiberRefModifySome;
  update5 = fiberRefUpdate;
  updateSome2 = fiberRefUpdateSome;
  updateAndGet2 = fiberRefUpdateAndGet;
  updateSomeAndGet2 = fiberRefUpdateSomeAndGet;
  currentConcurrency2 = currentConcurrency;
  currentRequestBatchingEnabled = currentRequestBatching;
  currentRequestCache = currentCache;
  currentRequestCacheEnabled = currentCacheEnabled;
  currentContext2 = currentContext;
  currentSchedulingPriority2 = currentSchedulingPriority;
  currentMaxOpsBeforeYield2 = currentMaxOpsBeforeYield;
  unhandledErrorLogLevel = currentUnhandledErrorLogLevel;
  currentLogAnnotations2 = currentLogAnnotations;
  currentLoggers2 = currentLoggers;
  currentLogLevel2 = currentLogLevel;
  currentMinimumLogLevel2 = currentMinimumLogLevel;
  currentLogSpan2 = currentLogSpan;
  currentRuntimeFlags2 = currentRuntimeFlags;
  currentScheduler2 = currentScheduler;
  currentSupervisor2 = currentSupervisor;
  currentMetricLabels2 = currentMetricLabels;
  currentTracerEnabled2 = currentTracerEnabled;
  currentTracerTimingEnabled2 = currentTracerTimingEnabled;
  currentTracerSpanAnnotations2 = currentTracerSpanAnnotations;
  currentTracerSpanLinks2 = currentTracerSpanLinks;
  interruptedCause = currentInterruptedCause;
});

// node_modules/effect/dist/esm/internal/layer/circular.js
var setConfigProvider = (configProvider) => scopedDiscard(withConfigProviderScoped(configProvider)), parentSpan = (span2) => succeedContext(make6(spanTag, span2)), span2 = (name, options) => {
  options = addSpanStackTrace(options);
  return scoped(spanTag, options?.onEnd ? tap(makeSpanScoped(name, options), (span3) => addFinalizer((exit3) => options.onEnd(span3, exit3))) : makeSpanScoped(name, options));
}, setTracer = (tracer3) => scopedDiscard(withTracerScoped(tracer3));
var init_circular3 = __esm(() => {
  init_Context();
  init_Function();
  init_HashSet();
  init_core();
  init_fiberRuntime();
  init_layer();
  init_runtimeFlags();
  init_runtimeFlagsPatch();
  init_supervisor();
  init_tracer();
});

// node_modules/effect/dist/esm/Layer.js
var exports_Layer = {};
__export(exports_Layer, {
  zipWith: () => zipWith7,
  withSpan: () => withSpan4,
  withParentSpan: () => withParentSpan4,
  updateService: () => updateService3,
  unwrapScoped: () => unwrapScoped2,
  unwrapEffect: () => unwrapEffect2,
  toRuntimeWithMemoMap: () => toRuntimeWithMemoMap2,
  toRuntime: () => toRuntime2,
  tapErrorCause: () => tapErrorCause4,
  tapError: () => tapError4,
  tap: () => tap4,
  syncContext: () => syncContext2,
  sync: () => sync4,
  suspend: () => suspend4,
  succeedContext: () => succeedContext2,
  succeed: () => succeed8,
  span: () => span3,
  setUnhandledErrorLogLevel: () => setUnhandledErrorLogLevel,
  setTracerTiming: () => setTracerTiming,
  setTracerEnabled: () => setTracerEnabled,
  setTracer: () => setTracer2,
  setScheduler: () => setScheduler,
  setRequestCaching: () => setRequestCaching,
  setRequestCache: () => setRequestCache,
  setRequestBatching: () => setRequestBatching,
  setConfigProvider: () => setConfigProvider2,
  setClock: () => setClock,
  service: () => service2,
  scopedDiscard: () => scopedDiscard2,
  scopedContext: () => scopedContext2,
  scoped: () => scoped3,
  scope: () => scope4,
  retry: () => retry3,
  provideMerge: () => provideMerge2,
  provide: () => provide3,
  project: () => project2,
  passthrough: () => passthrough3,
  parentSpan: () => parentSpan2,
  orElse: () => orElse6,
  orDie: () => orDie4,
  mergeAll: () => mergeAll6,
  merge: () => merge8,
  memoize: () => memoize3,
  matchCause: () => matchCause4,
  match: () => match14,
  mapError: () => mapError4,
  map: () => map14,
  makeMemoMap: () => makeMemoMap2,
  locallyWith: () => locallyWith2,
  locallyScoped: () => locallyScoped2,
  locallyEffect: () => locallyEffect2,
  locally: () => locally2,
  launch: () => launch2,
  isLayer: () => isLayer2,
  isFresh: () => isFresh2,
  function: () => fromFunction2,
  fresh: () => fresh2,
  flatten: () => flatten9,
  flatMap: () => flatMap11,
  fiberRefLocallyScopedWith: () => fiberRefLocallyScopedWith3,
  failSync: () => failSync4,
  failCauseSync: () => failCauseSync4,
  failCause: () => failCause8,
  fail: () => fail9,
  extendScope: () => extendScope2,
  empty: () => empty34,
  effectDiscard: () => effectDiscard,
  effectContext: () => effectContext,
  effect: () => effect,
  discard: () => discard2,
  dieSync: () => dieSync4,
  die: () => die7,
  context: () => context4,
  catchAllCause: () => catchAllCause4,
  catchAll: () => catchAll4,
  buildWithScope: () => buildWithScope2,
  buildWithMemoMap: () => buildWithMemoMap2,
  build: () => build2,
  annotateSpans: () => annotateSpans4,
  annotateLogs: () => annotateLogs4,
  MemoMapTypeId: () => MemoMapTypeId2,
  LayerTypeId: () => LayerTypeId2,
  CurrentMemoMap: () => CurrentMemoMap2
});
var LayerTypeId2, MemoMapTypeId2, CurrentMemoMap2, isLayer2, isFresh2, annotateLogs4, annotateSpans4, build2, buildWithScope2, catchAll4, catchAllCause4, context4, die7, dieSync4, discard2, effect, effectDiscard, effectContext, empty34, extendScope2, fail9, failSync4, failCause8, failCauseSync4, flatMap11, flatten9, fresh2, fromFunction2, launch2, map14, mapError4, match14, matchCause4, memoize3, merge8, mergeAll6, orDie4, orElse6, passthrough3, project2, locallyEffect2, locally2, locallyWith2, locallyScoped2, fiberRefLocallyScopedWith3, retry3, scope4, scoped3, scopedDiscard2, scopedContext2, service2, succeed8, succeedContext2, suspend4, sync4, syncContext2, tap4, tapError4, tapErrorCause4, toRuntime2, toRuntimeWithMemoMap2, provide3, provideMerge2, zipWith7, unwrapEffect2, unwrapScoped2, setClock = (clock3) => scopedDiscard2(fiberRefLocallyScopedWith(currentServices, add2(clockTag, clock3))), setConfigProvider2, parentSpan2, setRequestBatching = (requestBatching) => scopedDiscard2(fiberRefLocallyScoped(currentRequestBatching, requestBatching)), setRequestCaching = (requestCaching) => scopedDiscard2(fiberRefLocallyScoped(currentCacheEnabled, requestCaching)), setRequestCache = (cache) => scopedDiscard2(isEffect(cache) ? flatMap7(cache, (x) => fiberRefLocallyScoped(currentCache, x)) : fiberRefLocallyScoped(currentCache, cache)), setScheduler = (scheduler) => scopedDiscard2(fiberRefLocallyScoped(currentScheduler, scheduler)), span3, setTracer2, setTracerEnabled = (enabled2) => scopedDiscard2(fiberRefLocallyScoped(currentTracerEnabled, enabled2)), setTracerTiming = (enabled2) => scopedDiscard2(fiberRefLocallyScoped(currentTracerTimingEnabled, enabled2)), setUnhandledErrorLogLevel = (level) => scopedDiscard2(fiberRefLocallyScoped(currentUnhandledErrorLogLevel, level)), withSpan4, withParentSpan4, makeMemoMap2, buildWithMemoMap2, updateService3;
var init_Layer = __esm(() => {
  init_Context();
  init_Function();
  init_clock();
  init_core();
  init_defaultServices();
  init_fiberRuntime();
  init_layer();
  init_circular3();
  init_query();
  init_Scheduler();
  LayerTypeId2 = LayerTypeId;
  MemoMapTypeId2 = MemoMapTypeId;
  CurrentMemoMap2 = CurrentMemoMap;
  isLayer2 = isLayer;
  isFresh2 = isFresh;
  annotateLogs4 = annotateLogs2;
  annotateSpans4 = annotateSpans2;
  build2 = build;
  buildWithScope2 = buildWithScope;
  catchAll4 = catchAll2;
  catchAllCause4 = catchAllCause2;
  context4 = context2;
  die7 = die5;
  dieSync4 = dieSync2;
  discard2 = discard;
  effect = fromEffect3;
  effectDiscard = fromEffectDiscard;
  effectContext = fromEffectContext;
  empty34 = empty33;
  extendScope2 = extendScope;
  fail9 = fail6;
  failSync4 = failSync2;
  failCause8 = failCause5;
  failCauseSync4 = failCauseSync2;
  flatMap11 = flatMap9;
  flatten9 = flatten7;
  fresh2 = fresh;
  fromFunction2 = fromFunction;
  launch2 = launch;
  map14 = map12;
  mapError4 = mapError2;
  match14 = match12;
  matchCause4 = matchCause2;
  memoize3 = memoize2;
  merge8 = merge6;
  mergeAll6 = mergeAll4;
  orDie4 = orDie2;
  orElse6 = orElse4;
  passthrough3 = passthrough2;
  project2 = project;
  locallyEffect2 = locallyEffect;
  locally2 = fiberRefLocally2;
  locallyWith2 = fiberRefLocallyWith2;
  locallyScoped2 = fiberRefLocallyScoped2;
  fiberRefLocallyScopedWith3 = fiberRefLocallyScopedWith2;
  retry3 = retry;
  scope4 = scope2;
  scoped3 = scoped;
  scopedDiscard2 = scopedDiscard;
  scopedContext2 = scopedContext;
  service2 = service;
  succeed8 = succeed5;
  succeedContext2 = succeedContext;
  suspend4 = suspend2;
  sync4 = sync2;
  syncContext2 = syncContext;
  tap4 = tap2;
  tapError4 = tapError2;
  tapErrorCause4 = tapErrorCause2;
  toRuntime2 = toRuntime;
  toRuntimeWithMemoMap2 = toRuntimeWithMemoMap;
  provide3 = provide;
  provideMerge2 = provideMerge;
  zipWith7 = zipWith5;
  unwrapEffect2 = unwrapEffect;
  unwrapScoped2 = unwrapScoped;
  setConfigProvider2 = setConfigProvider;
  parentSpan2 = parentSpan;
  span3 = span2;
  setTracer2 = setTracer;
  withSpan4 = withSpan2;
  withParentSpan4 = withParentSpan2;
  makeMemoMap2 = makeMemoMap;
  buildWithMemoMap2 = buildWithMemoMap;
  updateService3 = /* @__PURE__ */ dual(3, (layer, tag, f) => provide3(layer, map14(context4(), (c) => add2(c, tag, f(unsafeGet3(c, tag))))));
});

// node_modules/effect/dist/esm/internal/queue.js
var init_queue = __esm(() => {
  init_Array();
  init_Chunk();
  init_Effectable();
  init_Function();
  init_MutableQueue();
  init_MutableRef();
  init_Option();
  init_Predicate();
  init_core();
  init_fiberRuntime();
});

// node_modules/effect/dist/esm/internal/pubsub.js
class UnboundedPubSub {
  replayBuffer;
  publisherHead = {
    value: AbsentValue,
    subscribers: 0,
    next: null
  };
  publisherTail = this.publisherHead;
  publisherIndex = 0;
  subscribersIndex = 0;
  capacity = Number.MAX_SAFE_INTEGER;
  constructor(replayBuffer) {
    this.replayBuffer = replayBuffer;
  }
  replayWindow() {
    return this.replayBuffer ? new ReplayWindowImpl(this.replayBuffer) : emptyReplayWindow;
  }
  isEmpty() {
    return this.publisherHead === this.publisherTail;
  }
  isFull() {
    return false;
  }
  size() {
    return this.publisherIndex - this.subscribersIndex;
  }
  publish(value) {
    const subscribers = this.publisherTail.subscribers;
    if (subscribers !== 0) {
      this.publisherTail.next = {
        value,
        subscribers,
        next: null
      };
      this.publisherTail = this.publisherTail.next;
      this.publisherIndex += 1;
    }
    if (this.replayBuffer) {
      this.replayBuffer.offer(value);
    }
    return true;
  }
  publishAll(elements) {
    if (this.publisherTail.subscribers !== 0) {
      for (const a of elements) {
        this.publish(a);
      }
    } else if (this.replayBuffer) {
      this.replayBuffer.offerAll(elements);
    }
    return empty5();
  }
  slide() {
    if (this.publisherHead !== this.publisherTail) {
      this.publisherHead = this.publisherHead.next;
      this.publisherHead.value = AbsentValue;
      this.subscribersIndex += 1;
    }
    if (this.replayBuffer) {
      this.replayBuffer.slide();
    }
  }
  subscribe() {
    this.publisherTail.subscribers += 1;
    return new UnboundedPubSubSubscription(this, this.publisherTail, this.publisherIndex, false);
  }
}

class UnboundedPubSubSubscription {
  self;
  subscriberHead;
  subscriberIndex;
  unsubscribed;
  constructor(self, subscriberHead, subscriberIndex, unsubscribed) {
    this.self = self;
    this.subscriberHead = subscriberHead;
    this.subscriberIndex = subscriberIndex;
    this.unsubscribed = unsubscribed;
  }
  isEmpty() {
    if (this.unsubscribed) {
      return true;
    }
    let empty35 = true;
    let loop3 = true;
    while (loop3) {
      if (this.subscriberHead === this.self.publisherTail) {
        loop3 = false;
      } else {
        if (this.subscriberHead.next.value !== AbsentValue) {
          empty35 = false;
          loop3 = false;
        } else {
          this.subscriberHead = this.subscriberHead.next;
          this.subscriberIndex += 1;
        }
      }
    }
    return empty35;
  }
  size() {
    if (this.unsubscribed) {
      return 0;
    }
    return this.self.publisherIndex - Math.max(this.subscriberIndex, this.self.subscribersIndex);
  }
  poll(default_) {
    if (this.unsubscribed) {
      return default_;
    }
    let loop3 = true;
    let polled = default_;
    while (loop3) {
      if (this.subscriberHead === this.self.publisherTail) {
        loop3 = false;
      } else {
        const elem = this.subscriberHead.next.value;
        if (elem !== AbsentValue) {
          polled = elem;
          this.subscriberHead.subscribers -= 1;
          if (this.subscriberHead.subscribers === 0) {
            this.self.publisherHead = this.self.publisherHead.next;
            this.self.publisherHead.value = AbsentValue;
            this.self.subscribersIndex += 1;
          }
          loop3 = false;
        }
        this.subscriberHead = this.subscriberHead.next;
        this.subscriberIndex += 1;
      }
    }
    return polled;
  }
  pollUpTo(n) {
    const builder = [];
    const default_ = AbsentValue;
    let i = 0;
    while (i !== n) {
      const a = this.poll(default_);
      if (a === default_) {
        i = n;
      } else {
        builder.push(a);
        i += 1;
      }
    }
    return fromIterable2(builder);
  }
  unsubscribe() {
    if (!this.unsubscribed) {
      this.unsubscribed = true;
      this.self.publisherTail.subscribers -= 1;
      while (this.subscriberHead !== this.self.publisherTail) {
        if (this.subscriberHead.next.value !== AbsentValue) {
          this.subscriberHead.subscribers -= 1;
          if (this.subscriberHead.subscribers === 0) {
            this.self.publisherHead = this.self.publisherHead.next;
            this.self.publisherHead.value = AbsentValue;
            this.self.subscribersIndex += 1;
          }
        }
        this.subscriberHead = this.subscriberHead.next;
      }
    }
  }
}

class ReplayBuffer {
  capacity;
  constructor(capacity2) {
    this.capacity = capacity2;
  }
  head = {
    value: AbsentValue,
    next: null
  };
  tail = this.head;
  size = 0;
  index = 0;
  slide() {
    this.index++;
  }
  offer(a) {
    this.tail.value = a;
    this.tail.next = {
      value: AbsentValue,
      next: null
    };
    this.tail = this.tail.next;
    if (this.size === this.capacity) {
      this.head = this.head.next;
    } else {
      this.size += 1;
    }
  }
  offerAll(as4) {
    for (const a of as4) {
      this.offer(a);
    }
  }
}

class ReplayWindowImpl {
  buffer;
  head;
  index;
  remaining;
  constructor(buffer) {
    this.buffer = buffer;
    this.index = buffer.index;
    this.remaining = buffer.size;
    this.head = buffer.head;
  }
  fastForward() {
    while (this.index < this.buffer.index) {
      this.head = this.head.next;
      this.index++;
    }
  }
  take() {
    if (this.remaining === 0) {
      return;
    } else if (this.index < this.buffer.index) {
      this.fastForward();
    }
    this.remaining--;
    const value = this.head.value;
    this.head = this.head.next;
    return value;
  }
  takeN(n) {
    if (this.remaining === 0) {
      return empty5();
    } else if (this.index < this.buffer.index) {
      this.fastForward();
    }
    const len = Math.min(n, this.remaining);
    const items = new Array(len);
    for (let i = 0;i < len; i++) {
      const value = this.head.value;
      this.head = this.head.next;
      items[i] = value;
    }
    this.remaining -= len;
    return unsafeFromArray(items);
  }
  takeAll() {
    return this.takeN(this.remaining);
  }
}
var AbsentValue, emptyReplayWindow;
var init_pubsub = __esm(() => {
  init_Chunk();
  init_Effectable();
  init_Function();
  init_MutableQueue();
  init_MutableRef();
  init_Number();
  init_Option();
  init_core();
  init_executionStrategy();
  init_fiberRuntime();
  init_queue();
  AbsentValue = /* @__PURE__ */ Symbol.for("effect/PubSub/AbsentValue");
  emptyReplayWindow = {
    remaining: 0,
    take: () => {
      return;
    },
    takeN: () => empty5(),
    takeAll: () => empty5()
  };
});

// node_modules/effect/dist/esm/PubSub.js
var init_PubSub = __esm(() => {
  init_pubsub();
});

// node_modules/effect/dist/esm/Queue.js
var init_Queue = __esm(() => {
  init_queue();
});
// node_modules/effect/dist/esm/internal/channel/childExecutorDecision.js
var ChildExecutorDecisionSymbolKey = "effect/ChannelChildExecutorDecision", ChildExecutorDecisionTypeId, proto4;
var init_childExecutorDecision = __esm(() => {
  init_Function();
  init_Predicate();
  ChildExecutorDecisionTypeId = /* @__PURE__ */ Symbol.for(ChildExecutorDecisionSymbolKey);
  proto4 = {
    [ChildExecutorDecisionTypeId]: ChildExecutorDecisionTypeId
  };
});
// node_modules/effect/dist/esm/internal/channel/continuation.js
var init_continuation = __esm(() => {
  init_Exit();
});
// node_modules/effect/dist/esm/internal/channel/upstreamPullStrategy.js
var UpstreamPullStrategySymbolKey = "effect/ChannelUpstreamPullStrategy", UpstreamPullStrategyTypeId, upstreamPullStrategyVariance, proto5;
var init_upstreamPullStrategy = __esm(() => {
  init_Function();
  init_Predicate();
  UpstreamPullStrategyTypeId = /* @__PURE__ */ Symbol.for(UpstreamPullStrategySymbolKey);
  upstreamPullStrategyVariance = {
    _A: (_) => _
  };
  proto5 = {
    [UpstreamPullStrategyTypeId]: upstreamPullStrategyVariance
  };
});
// node_modules/effect/dist/esm/internal/core-stream.js
var ChannelSymbolKey = "effect/Channel", ChannelTypeId2, channelVariance2, proto6;
var init_core_stream = __esm(() => {
  init_Cause();
  init_Chunk();
  init_Effect();
  init_Either();
  init_Function();
  init_Option();
  init_Predicate();
  init_childExecutorDecision();
  init_continuation();
  init_upstreamPullStrategy();
  ChannelTypeId2 = /* @__PURE__ */ Symbol.for(ChannelSymbolKey);
  channelVariance2 = {
    _Env: (_) => _,
    _InErr: (_) => _,
    _InElem: (_) => _,
    _InDone: (_) => _,
    _OutErr: (_) => _,
    _OutElem: (_) => _,
    _OutDone: (_) => _
  };
  proto6 = {
    [ChannelTypeId2]: channelVariance2,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});
// node_modules/effect/dist/esm/internal/channel/channelState.js
var ChannelStateTypeId, channelStateVariance, proto7;
var init_channelState = __esm(() => {
  init_Effect();
  init_Predicate();
  ChannelStateTypeId = /* @__PURE__ */ Symbol.for("effect/ChannelState");
  channelStateVariance = {
    _E: (_) => _,
    _R: (_) => _
  };
  proto7 = {
    [ChannelStateTypeId]: channelStateVariance
  };
});

// node_modules/effect/dist/esm/internal/channel/subexecutor.js
var init_subexecutor = __esm(() => {
  init_Effect();
  init_Exit();
  init_Function();
});
// node_modules/effect/dist/esm/internal/channel/upstreamPullRequest.js
var UpstreamPullRequestSymbolKey = "effect/ChannelUpstreamPullRequest", UpstreamPullRequestTypeId, upstreamPullRequestVariance, proto8;
var init_upstreamPullRequest = __esm(() => {
  init_Function();
  init_Predicate();
  UpstreamPullRequestTypeId = /* @__PURE__ */ Symbol.for(UpstreamPullRequestSymbolKey);
  upstreamPullRequestVariance = {
    _A: (_) => _
  };
  proto8 = {
    [UpstreamPullRequestTypeId]: upstreamPullRequestVariance
  };
});

// node_modules/effect/dist/esm/internal/channel/channelExecutor.js
var init_channelExecutor = __esm(() => {
  init_Cause();
  init_Deferred();
  init_Effect();
  init_ExecutionStrategy();
  init_Exit();
  init_Fiber();
  init_FiberId();
  init_Function();
  init_HashSet();
  init_Option();
  init_Scope();
  init_core_stream();
  init_channelState();
  init_continuation();
  init_subexecutor();
  init_upstreamPullRequest();
});
// node_modules/effect/dist/esm/internal/channel/mergeDecision.js
var MergeDecisionSymbolKey = "effect/ChannelMergeDecision", MergeDecisionTypeId, proto9;
var init_mergeDecision = __esm(() => {
  init_Function();
  init_Predicate();
  MergeDecisionTypeId = /* @__PURE__ */ Symbol.for(MergeDecisionSymbolKey);
  proto9 = {
    [MergeDecisionTypeId]: {
      _R: (_) => _,
      _E0: (_) => _,
      _Z0: (_) => _,
      _E: (_) => _,
      _Z: (_) => _
    }
  };
});
// node_modules/effect/dist/esm/internal/channel/mergeState.js
var MergeStateSymbolKey = "effect/ChannelMergeState", MergeStateTypeId, proto10;
var init_mergeState = __esm(() => {
  init_Function();
  init_Predicate();
  MergeStateTypeId = /* @__PURE__ */ Symbol.for(MergeStateSymbolKey);
  proto10 = {
    [MergeStateTypeId]: MergeStateTypeId
  };
});
// node_modules/effect/dist/esm/internal/channel/mergeStrategy.js
var MergeStrategySymbolKey = "effect/ChannelMergeStrategy", MergeStrategyTypeId, proto11;
var init_mergeStrategy = __esm(() => {
  init_Function();
  init_Predicate();
  MergeStrategyTypeId = /* @__PURE__ */ Symbol.for(MergeStrategySymbolKey);
  proto11 = {
    [MergeStrategyTypeId]: MergeStrategyTypeId
  };
});

// node_modules/effect/dist/esm/internal/channel/singleProducerAsyncInput.js
var init_singleProducerAsyncInput = __esm(() => {
  init_Cause();
  init_Deferred();
  init_Effect();
  init_Either();
  init_Exit();
  init_Function();
  init_Ref();
});

// node_modules/effect/dist/esm/internal/channel.js
var init_channel = __esm(() => {
  init_Cause();
  init_Chunk();
  init_Context();
  init_Deferred();
  init_Effect();
  init_Either();
  init_Equal();
  init_Exit();
  init_Fiber();
  init_FiberRef();
  init_Function();
  init_Layer();
  init_Option();
  init_Predicate();
  init_PubSub();
  init_Queue();
  init_Ref();
  init_Scope();
  init_channelExecutor();
  init_mergeDecision();
  init_mergeState();
  init_mergeStrategy();
  init_singleProducerAsyncInput();
  init_core_effect();
  init_core_stream();
  init_tracer();
});

// node_modules/effect/dist/esm/internal/sink.js
var SinkTypeId2;
var init_sink = __esm(() => {
  init_Array();
  init_Cause();
  init_Chunk();
  init_Clock();
  init_Duration();
  init_Effect();
  init_Either();
  init_Exit();
  init_Function();
  init_HashMap();
  init_HashSet();
  init_Option();
  init_Predicate();
  init_PubSub();
  init_Queue();
  init_Ref();
  init_Scope();
  init_channel();
  init_mergeDecision();
  init_core_stream();
  SinkTypeId2 = /* @__PURE__ */ Symbol.for("effect/Sink");
});

// node_modules/effect/dist/esm/MergeDecision.js
var init_MergeDecision = __esm(() => {
  init_mergeDecision();
});

// node_modules/effect/dist/esm/internal/rcRef.js
var init_rcRef = __esm(() => {
  init_Context();
  init_Duration();
  init_Effectable();
  init_Function();
  init_Readable();
  init_core_effect();
  init_core();
  init_circular();
  init_fiberRuntime();
});

// node_modules/effect/dist/esm/RcRef.js
var init_RcRef = __esm(() => {
  init_rcRef();
});

// node_modules/effect/dist/esm/Runtime.js
var init_Runtime = __esm(() => {
  init_runtime();
});

// node_modules/effect/dist/esm/Schedule.js
var init_Schedule = __esm(() => {
  init_schedule();
});
// node_modules/effect/dist/esm/internal/stream/haltStrategy.js
var init_haltStrategy = __esm(() => {
  init_Function();
});

// node_modules/effect/dist/esm/StreamHaltStrategy.js
var init_StreamHaltStrategy = __esm(() => {
  init_haltStrategy();
});

// node_modules/effect/dist/esm/internal/stm/versioned.js
class Versioned {
  value;
  constructor(value) {
    this.value = value;
  }
}

// node_modules/effect/dist/esm/internal/stm/entry.js
var make47 = (ref, isNew) => ({
  ref,
  isNew,
  isChanged: false,
  expected: ref.versioned,
  newValue: ref.versioned.value
}), unsafeGet7 = (self) => {
  return self.newValue;
}, unsafeSet = (self, value) => {
  self.isChanged = true;
  self.newValue = value;
}, commit = (self) => {
  self.ref.versioned = new Versioned(self.newValue);
}, isInvalid = (self) => {
  return self.ref.versioned !== self.expected;
}, isChanged = (self) => {
  return self.isChanged;
};
var init_entry = () => {};

// node_modules/effect/dist/esm/internal/stm/journal.js
var JournalAnalysisInvalid = "Invalid", JournalAnalysisReadWrite = "ReadWrite", JournalAnalysisReadOnly = "ReadOnly", commitJournal = (journal) => {
  for (const entry of journal) {
    commit(entry[1]);
  }
}, analyzeJournal = (journal) => {
  let val = JournalAnalysisReadOnly;
  for (const [, entry] of journal) {
    val = isInvalid(entry) ? JournalAnalysisInvalid : isChanged(entry) ? JournalAnalysisReadWrite : val;
    if (val === JournalAnalysisInvalid) {
      return val;
    }
  }
  return val;
}, collectTodos = (journal) => {
  const allTodos = new Map;
  for (const [, entry] of journal) {
    for (const todo of entry.ref.todos) {
      allTodos.set(todo[0], todo[1]);
    }
    entry.ref.todos = new Map;
  }
  return allTodos;
}, execTodos = (todos) => {
  const todosSorted = Array.from(todos.entries()).sort((x, y) => x[0] - y[0]);
  for (const [_, todo] of todosSorted) {
    todo();
  }
}, addTodo = (txnId, journal, todoEffect) => {
  let added = false;
  for (const [, entry] of journal) {
    if (!entry.ref.todos.has(txnId)) {
      entry.ref.todos.set(txnId, todoEffect);
      added = true;
    }
  }
  return added;
};
var init_journal = __esm(() => {
  init_entry();
});

// node_modules/effect/dist/esm/internal/stm/opCodes/stm.js
var OP_WITH_STM_RUNTIME = "WithSTMRuntime", OP_ON_FAILURE2 = "OnFailure", OP_ON_RETRY = "OnRetry", OP_ON_SUCCESS2 = "OnSuccess", OP_PROVIDE3 = "Provide", OP_SYNC2 = "Sync", OP_SUCCEED2 = "Succeed", OP_RETRY = "Retry", OP_FAIL4 = "Fail", OP_DIE2 = "Die", OP_INTERRUPT2 = "Interrupt";

// node_modules/effect/dist/esm/internal/stm/opCodes/tExit.js
var OP_FAIL5 = "Fail", OP_DIE3 = "Die", OP_INTERRUPT3 = "Interrupt", OP_SUCCEED3 = "Succeed", OP_RETRY2 = "Retry";

// node_modules/effect/dist/esm/internal/stm/opCodes/tryCommit.js
var OP_DONE5 = "Done", OP_SUSPEND3 = "Suspend";

// node_modules/effect/dist/esm/internal/stm/opCodes/stmState.js
var OP_DONE6 = "Done", OP_INTERRUPTED = "Interrupted", OP_RUNNING2 = "Running";

// node_modules/effect/dist/esm/internal/stm/stmState.js
var STMStateSymbolKey = "effect/STM/State", STMStateTypeId, isSTMState = (u) => hasProperty(u, STMStateTypeId), isRunning3 = (self) => {
  return self._tag === OP_RUNNING2;
}, isDone6 = (self) => {
  return self._tag === OP_DONE6;
}, done8 = (exit3) => {
  return {
    [STMStateTypeId]: STMStateTypeId,
    _tag: OP_DONE6,
    exit: exit3,
    [symbol]() {
      return pipe(hash(STMStateSymbolKey), combine(hash(OP_DONE6)), combine(hash(exit3)), cached(this));
    },
    [symbol2](that) {
      return isSTMState(that) && that._tag === OP_DONE6 && equals(exit3, that.exit);
    }
  };
}, interruptedHash, interrupted2, runningHash, running3, fromTExit = (tExit) => {
  switch (tExit._tag) {
    case OP_FAIL5: {
      return done8(fail3(tExit.error));
    }
    case OP_DIE3: {
      return done8(die3(tExit.defect));
    }
    case OP_INTERRUPT3: {
      return done8(interrupt4(tExit.fiberId));
    }
    case OP_SUCCEED3: {
      return done8(succeed2(tExit.value));
    }
    case OP_RETRY2: {
      throw new Error("BUG: STM.STMState.fromTExit - please report an issue at https://github.com/Effect-TS/effect/issues");
    }
  }
};
var init_stmState = __esm(() => {
  init_Equal();
  init_Exit();
  init_Function();
  init_Hash();
  init_Predicate();
  STMStateTypeId = /* @__PURE__ */ Symbol.for(STMStateSymbolKey);
  interruptedHash = /* @__PURE__ */ pipe(/* @__PURE__ */ hash(STMStateSymbolKey), /* @__PURE__ */ combine(/* @__PURE__ */ hash(OP_INTERRUPTED)), /* @__PURE__ */ combine(/* @__PURE__ */ hash("interrupted")));
  interrupted2 = {
    [STMStateTypeId]: STMStateTypeId,
    _tag: OP_INTERRUPTED,
    [symbol]() {
      return interruptedHash;
    },
    [symbol2](that) {
      return isSTMState(that) && that._tag === OP_INTERRUPTED;
    }
  };
  runningHash = /* @__PURE__ */ pipe(/* @__PURE__ */ hash(STMStateSymbolKey), /* @__PURE__ */ combine(/* @__PURE__ */ hash(OP_RUNNING2)), /* @__PURE__ */ combine(/* @__PURE__ */ hash("running")));
  running3 = {
    [STMStateTypeId]: STMStateTypeId,
    _tag: OP_RUNNING2,
    [symbol]() {
      return runningHash;
    },
    [symbol2](that) {
      return isSTMState(that) && that._tag === OP_RUNNING2;
    }
  };
});

// node_modules/effect/dist/esm/internal/stm/tExit.js
var TExitSymbolKey = "effect/TExit", TExitTypeId, variance8, isExit = (u) => hasProperty(u, TExitTypeId), isSuccess4 = (self) => {
  return self._tag === OP_SUCCEED3;
}, isRetry = (self) => {
  return self._tag === OP_RETRY2;
}, fail11 = (error) => ({
  [TExitTypeId]: variance8,
  _tag: OP_FAIL5,
  error,
  [symbol]() {
    return pipe(hash(TExitSymbolKey), combine(hash(OP_FAIL5)), combine(hash(error)), cached(this));
  },
  [symbol2](that) {
    return isExit(that) && that._tag === OP_FAIL5 && equals(error, that.error);
  }
}), die8 = (defect) => ({
  [TExitTypeId]: variance8,
  _tag: OP_DIE3,
  defect,
  [symbol]() {
    return pipe(hash(TExitSymbolKey), combine(hash(OP_DIE3)), combine(hash(defect)), cached(this));
  },
  [symbol2](that) {
    return isExit(that) && that._tag === OP_DIE3 && equals(defect, that.defect);
  }
}), interrupt8 = (fiberId3) => ({
  [TExitTypeId]: variance8,
  _tag: OP_INTERRUPT3,
  fiberId: fiberId3,
  [symbol]() {
    return pipe(hash(TExitSymbolKey), combine(hash(OP_INTERRUPT3)), combine(hash(fiberId3)), cached(this));
  },
  [symbol2](that) {
    return isExit(that) && that._tag === OP_INTERRUPT3 && equals(fiberId3, that.fiberId);
  }
}), succeed12 = (value) => ({
  [TExitTypeId]: variance8,
  _tag: OP_SUCCEED3,
  value,
  [symbol]() {
    return pipe(hash(TExitSymbolKey), combine(hash(OP_SUCCEED3)), combine(hash(value)), cached(this));
  },
  [symbol2](that) {
    return isExit(that) && that._tag === OP_SUCCEED3 && equals(value, that.value);
  }
}), retryHash, retry4;
var init_tExit = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Predicate();
  TExitTypeId = /* @__PURE__ */ Symbol.for(TExitSymbolKey);
  variance8 = {
    _A: (_) => _,
    _E: (_) => _
  };
  retryHash = /* @__PURE__ */ pipe(/* @__PURE__ */ hash(TExitSymbolKey), /* @__PURE__ */ combine(/* @__PURE__ */ hash(OP_RETRY2)), /* @__PURE__ */ combine(/* @__PURE__ */ hash("retry")));
  retry4 = {
    [TExitTypeId]: variance8,
    _tag: OP_RETRY2,
    [symbol]() {
      return retryHash;
    },
    [symbol2](that) {
      return isExit(that) && isRetry(that);
    }
  };
});

// node_modules/effect/dist/esm/internal/stm/tryCommit.js
var done9 = (exit3) => {
  return {
    _tag: OP_DONE5,
    exit: exit3
  };
}, suspend6 = (journal) => {
  return {
    _tag: OP_SUSPEND3,
    journal
  };
};
var init_tryCommit = () => {};

// node_modules/effect/dist/esm/internal/stm/txnId.js
var txnCounter, make48 = () => {
  const newId = txnCounter.ref + 1;
  txnCounter.ref = newId;
  return newId;
};
var init_txnId = __esm(() => {
  txnCounter = {
    ref: 0
  };
});

// node_modules/effect/dist/esm/internal/stm/core.js
class STMDriver {
  self;
  journal;
  fiberId;
  contStack = [];
  env;
  constructor(self, journal, fiberId3, r0) {
    this.self = self;
    this.journal = journal;
    this.fiberId = fiberId3;
    this.env = r0;
  }
  getEnv() {
    return this.env;
  }
  pushStack(cont) {
    this.contStack.push(cont);
  }
  popStack() {
    return this.contStack.pop();
  }
  nextSuccess() {
    let current = this.popStack();
    while (current !== undefined && current.effect_instruction_i0 !== OP_ON_SUCCESS2) {
      current = this.popStack();
    }
    return current;
  }
  nextFailure() {
    let current = this.popStack();
    while (current !== undefined && current.effect_instruction_i0 !== OP_ON_FAILURE2) {
      current = this.popStack();
    }
    return current;
  }
  nextRetry() {
    let current = this.popStack();
    while (current !== undefined && current.effect_instruction_i0 !== OP_ON_RETRY) {
      current = this.popStack();
    }
    return current;
  }
  run() {
    let curr = this.self;
    let exit3 = undefined;
    while (exit3 === undefined && curr !== undefined) {
      try {
        const current = curr;
        if (current) {
          switch (current._op) {
            case "Tag": {
              curr = effect3((_, __, env) => unsafeGet3(env, current));
              break;
            }
            case "Left": {
              curr = fail12(current.left);
              break;
            }
            case "None": {
              curr = fail12(new NoSuchElementException2);
              break;
            }
            case "Right": {
              curr = succeed13(current.right);
              break;
            }
            case "Some": {
              curr = succeed13(current.value);
              break;
            }
            case "Commit": {
              switch (current.effect_instruction_i0) {
                case OP_DIE2: {
                  exit3 = die8(internalCall(() => current.effect_instruction_i1()));
                  break;
                }
                case OP_FAIL4: {
                  const cont = this.nextFailure();
                  if (cont === undefined) {
                    exit3 = fail11(internalCall(() => current.effect_instruction_i1()));
                  } else {
                    curr = internalCall(() => cont.effect_instruction_i2(internalCall(() => current.effect_instruction_i1())));
                  }
                  break;
                }
                case OP_RETRY: {
                  const cont = this.nextRetry();
                  if (cont === undefined) {
                    exit3 = retry4;
                  } else {
                    curr = internalCall(() => cont.effect_instruction_i2());
                  }
                  break;
                }
                case OP_INTERRUPT2: {
                  exit3 = interrupt8(this.fiberId);
                  break;
                }
                case OP_WITH_STM_RUNTIME: {
                  curr = internalCall(() => current.effect_instruction_i1(this));
                  break;
                }
                case OP_ON_SUCCESS2:
                case OP_ON_FAILURE2:
                case OP_ON_RETRY: {
                  this.pushStack(current);
                  curr = current.effect_instruction_i1;
                  break;
                }
                case OP_PROVIDE3: {
                  const env = this.env;
                  this.env = internalCall(() => current.effect_instruction_i2(env));
                  curr = pipe(current.effect_instruction_i1, ensuring5(sync7(() => this.env = env)));
                  break;
                }
                case OP_SUCCEED2: {
                  const value = current.effect_instruction_i1;
                  const cont = this.nextSuccess();
                  if (cont === undefined) {
                    exit3 = succeed12(value);
                  } else {
                    curr = internalCall(() => cont.effect_instruction_i2(value));
                  }
                  break;
                }
                case OP_SYNC2: {
                  const value = internalCall(() => current.effect_instruction_i1());
                  const cont = this.nextSuccess();
                  if (cont === undefined) {
                    exit3 = succeed12(value);
                  } else {
                    curr = internalCall(() => cont.effect_instruction_i2(value));
                  }
                  break;
                }
              }
              break;
            }
          }
        }
      } catch (e) {
        curr = die9(e);
      }
    }
    return exit3;
  }
}
var STMSymbolKey2 = "effect/STM", STMTypeId2, stmVariance, STMPrimitive, unsafeAtomically = (self, onDone, onInterrupt3) => withFiberRuntime((state) => {
  const fiberId3 = state.id();
  const env = state.getFiberRef(currentContext2);
  const scheduler = state.getFiberRef(currentScheduler2);
  const priority = state.getFiberRef(currentSchedulingPriority2);
  const commitResult = tryCommitSync(fiberId3, self, env, scheduler, priority);
  switch (commitResult._tag) {
    case OP_DONE5: {
      onDone(commitResult.exit);
      return commitResult.exit;
    }
    case OP_SUSPEND3: {
      const txnId = make48();
      const state2 = {
        value: running3
      };
      const effect3 = async((k) => tryCommitAsync(fiberId3, self, txnId, state2, env, scheduler, priority, k));
      return uninterruptibleMask3((restore) => pipe(restore(effect3), catchAllCause3((cause3) => {
        let currentState = state2.value;
        if (isRunning3(currentState)) {
          state2.value = interrupted2;
        }
        currentState = state2.value;
        if (isDone6(currentState)) {
          onDone(currentState.exit);
          return currentState.exit;
        }
        onInterrupt3();
        return failCause7(cause3);
      })));
    }
  }
}), tryCommit = (fiberId3, stm, state, env, scheduler, priority) => {
  const journal = new Map;
  const tExit = new STMDriver(stm, journal, fiberId3, env).run();
  const analysis = analyzeJournal(journal);
  if (analysis === JournalAnalysisReadWrite) {
    commitJournal(journal);
  } else if (analysis === JournalAnalysisInvalid) {
    throw new Error("BUG: STM.TryCommit.tryCommit - please report an issue at https://github.com/Effect-TS/effect/issues");
  }
  switch (tExit._tag) {
    case OP_SUCCEED3: {
      state.value = fromTExit(tExit);
      return completeTodos(succeed2(tExit.value), journal, scheduler, priority);
    }
    case OP_FAIL5: {
      state.value = fromTExit(tExit);
      const cause3 = fail4(tExit.error);
      return completeTodos(failCause2(cause3), journal, scheduler, priority);
    }
    case OP_DIE3: {
      state.value = fromTExit(tExit);
      const cause3 = die4(tExit.defect);
      return completeTodos(failCause2(cause3), journal, scheduler, priority);
    }
    case OP_INTERRUPT3: {
      state.value = fromTExit(tExit);
      const cause3 = interrupt5(fiberId3);
      return completeTodos(failCause2(cause3), journal, scheduler, priority);
    }
    case OP_RETRY2: {
      return suspend6(journal);
    }
  }
}, tryCommitSync = (fiberId3, stm, env, scheduler, priority) => {
  const journal = new Map;
  const tExit = new STMDriver(stm, journal, fiberId3, env).run();
  const analysis = analyzeJournal(journal);
  if (analysis === JournalAnalysisReadWrite && isSuccess4(tExit)) {
    commitJournal(journal);
  } else if (analysis === JournalAnalysisInvalid) {
    throw new Error("BUG: STM.TryCommit.tryCommitSync - please report an issue at https://github.com/Effect-TS/effect/issues");
  }
  switch (tExit._tag) {
    case OP_SUCCEED3: {
      return completeTodos(succeed2(tExit.value), journal, scheduler, priority);
    }
    case OP_FAIL5: {
      const cause3 = fail4(tExit.error);
      return completeTodos(failCause2(cause3), journal, scheduler, priority);
    }
    case OP_DIE3: {
      const cause3 = die4(tExit.defect);
      return completeTodos(failCause2(cause3), journal, scheduler, priority);
    }
    case OP_INTERRUPT3: {
      const cause3 = interrupt5(fiberId3);
      return completeTodos(failCause2(cause3), journal, scheduler, priority);
    }
    case OP_RETRY2: {
      return suspend6(journal);
    }
  }
}, tryCommitAsync = (fiberId3, self, txnId, state, context5, scheduler, priority, k) => {
  if (isRunning3(state.value)) {
    const result = tryCommit(fiberId3, self, state, context5, scheduler, priority);
    switch (result._tag) {
      case OP_DONE5: {
        completeTryCommit(result.exit, k);
        break;
      }
      case OP_SUSPEND3: {
        addTodo(txnId, result.journal, () => tryCommitAsync(fiberId3, self, txnId, state, context5, scheduler, priority, k));
        break;
      }
    }
  }
}, completeTodos = (exit3, journal, scheduler, priority) => {
  const todos = collectTodos(journal);
  if (todos.size > 0) {
    scheduler.scheduleTask(() => execTodos(todos), priority);
  }
  return done9(exit3);
}, completeTryCommit = (exit3, k) => {
  k(exit3);
}, catchAll6, die9 = (defect) => dieSync5(() => defect), dieSync5 = (evaluate2) => {
  const stm = new STMPrimitive(OP_DIE2);
  stm.effect_instruction_i1 = evaluate2;
  return stm;
}, effect3 = (f) => withSTMRuntime((_) => succeed13(f(_.journal, _.fiberId, _.getEnv()))), ensuring5, fail12 = (error) => failSync6(() => error), failSync6 = (evaluate2) => {
  const stm = new STMPrimitive(OP_FAIL4);
  stm.effect_instruction_i1 = evaluate2;
  return stm;
}, flatMap13, matchSTM, withSTMRuntime = (f) => {
  const stm = new STMPrimitive(OP_WITH_STM_RUNTIME);
  stm.effect_instruction_i1 = f;
  return stm;
}, interruptAs2 = (fiberId3) => {
  const stm = new STMPrimitive(OP_INTERRUPT2);
  stm.effect_instruction_i1 = fiberId3;
  return stm;
}, map19, retry5, succeed13 = (value) => {
  const stm = new STMPrimitive(OP_SUCCEED2);
  stm.effect_instruction_i1 = value;
  return stm;
}, sync7 = (evaluate2) => {
  const stm = new STMPrimitive(OP_SYNC2);
  stm.effect_instruction_i1 = evaluate2;
  return stm;
}, zipRight6, zipWith9;
var init_core2 = __esm(() => {
  init_Cause();
  init_Context();
  init_Effect();
  init_Either();
  init_Equal();
  init_Exit();
  init_FiberRef();
  init_Function();
  init_Hash();
  init_Predicate();
  init_Utils();
  init_core_stream();
  init_core();
  init_effectable();
  init_singleShotGen();
  init_sink();
  init_journal();
  init_stmState();
  init_tExit();
  init_tryCommit();
  init_txnId();
  STMTypeId2 = /* @__PURE__ */ Symbol.for(STMSymbolKey2);
  stmVariance = {
    _R: (_) => _,
    _E: (_) => _,
    _A: (_) => _
  };
  STMPrimitive = class STMPrimitive {
    effect_instruction_i0;
    _op = OP_COMMIT;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    [EffectTypeId3];
    [StreamTypeId];
    [SinkTypeId2];
    [ChannelTypeId2];
    get [STMTypeId2]() {
      return stmVariance;
    }
    constructor(effect_instruction_i0) {
      this.effect_instruction_i0 = effect_instruction_i0;
      this[EffectTypeId3] = effectVariance;
      this[StreamTypeId] = stmVariance;
      this[SinkTypeId2] = stmVariance;
      this[ChannelTypeId2] = stmVariance;
    }
    [symbol2](that) {
      return this === that;
    }
    [symbol]() {
      return cached(this, random(this));
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
    commit() {
      return unsafeAtomically(this, constVoid, constVoid);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  catchAll6 = /* @__PURE__ */ dual(2, (self, f) => {
    const stm = new STMPrimitive(OP_ON_FAILURE2);
    stm.effect_instruction_i1 = self;
    stm.effect_instruction_i2 = f;
    return stm;
  });
  ensuring5 = /* @__PURE__ */ dual(2, (self, finalizer) => matchSTM(self, {
    onFailure: (e) => zipRight6(finalizer, fail12(e)),
    onSuccess: (a) => zipRight6(finalizer, succeed13(a))
  }));
  flatMap13 = /* @__PURE__ */ dual(2, (self, f) => {
    const stm = new STMPrimitive(OP_ON_SUCCESS2);
    stm.effect_instruction_i1 = self;
    stm.effect_instruction_i2 = f;
    return stm;
  });
  matchSTM = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => pipe(self, map19(right2), catchAll6((e) => pipe(onFailure(e), map19(left2))), flatMap13((either5) => {
    switch (either5._tag) {
      case "Left": {
        return succeed13(either5.left);
      }
      case "Right": {
        return onSuccess(either5.right);
      }
    }
  })));
  map19 = /* @__PURE__ */ dual(2, (self, f) => pipe(self, flatMap13((a) => sync7(() => f(a)))));
  retry5 = /* @__PURE__ */ new STMPrimitive(OP_RETRY);
  zipRight6 = /* @__PURE__ */ dual(2, (self, that) => pipe(self, flatMap13(() => that)));
  zipWith9 = /* @__PURE__ */ dual(3, (self, that, f) => pipe(self, flatMap13((a) => pipe(that, map19((b) => f(a, b))))));
});

// node_modules/effect/dist/esm/internal/stm/opCodes/strategy.js
var OP_BACKPRESSURE_STRATEGY = "BackPressure", OP_DROPPING_STRATEGY = "Dropping", OP_SLIDING_STRATEGY = "Sliding";

// node_modules/effect/dist/esm/internal/stm/stm.js
var flatten11 = (self) => flatMap13(self, identity), forEach9, suspend7 = (evaluate2) => flatten11(sync7(evaluate2)), void_6;
var init_stm = __esm(() => {
  init_Array();
  init_Cause();
  init_Chunk();
  init_Context();
  init_Effect();
  init_Either();
  init_Exit();
  init_Function();
  init_Option();
  init_Predicate();
  init_Utils();
  init_core();
  init_core2();
  init_journal();
  init_stmState();
  forEach9 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (iterable, f, options) => {
    if (options?.discard) {
      return pipe(sync7(() => iterable[Symbol.iterator]()), flatMap13((iterator) => {
        const loop3 = suspend7(() => {
          const next4 = iterator.next();
          if (next4.done) {
            return void_6;
          }
          return pipe(f(next4.value), flatMap13(() => loop3));
        });
        return loop3;
      }));
    }
    return suspend7(() => fromIterable(iterable).reduce((acc, curr) => zipWith9(acc, f(curr), (array4, elem) => {
      array4.push(elem);
      return array4;
    }), succeed13([])));
  });
  void_6 = /* @__PURE__ */ succeed13(undefined);
});

// node_modules/effect/dist/esm/internal/stm/tRef.js
var TRefSymbolKey = "effect/TRef", TRefTypeId, tRefVariance, TRefImpl, getOrMakeEntry = (self, journal) => {
  if (journal.has(self)) {
    return journal.get(self);
  }
  const entry = make47(self, false);
  journal.set(self, entry);
  return entry;
}, unsafeGet8, unsafeSet2;
var init_tRef = __esm(() => {
  init_Function();
  init_Option();
  init_core2();
  init_entry();
  TRefTypeId = /* @__PURE__ */ Symbol.for(TRefSymbolKey);
  tRefVariance = {
    _A: (_) => _
  };
  TRefImpl = class TRefImpl {
    [TRefTypeId] = tRefVariance;
    todos;
    versioned;
    constructor(value) {
      this.versioned = new Versioned(value);
      this.todos = new Map;
    }
    modify(f) {
      return effect3((journal) => {
        const entry = getOrMakeEntry(this, journal);
        const [retValue, newValue] = f(unsafeGet7(entry));
        unsafeSet(entry, newValue);
        return retValue;
      });
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  unsafeGet8 = /* @__PURE__ */ dual(2, (self, journal) => unsafeGet7(getOrMakeEntry(self, journal)));
  unsafeSet2 = /* @__PURE__ */ dual(3, (self, value, journal) => {
    const entry = getOrMakeEntry(self, journal);
    unsafeSet(entry, value);
    return;
  });
});

// node_modules/effect/dist/esm/internal/stm/tQueue.js
var TEnqueueSymbolKey = "effect/TQueue/TEnqueue", TEnqueueTypeId, TDequeueSymbolKey = "effect/TQueue/TDequeue", TDequeueTypeId, tDequeueVariance, tEnqueueVariance, TQueueImpl;
var init_tQueue = __esm(() => {
  init_Array();
  init_Chunk();
  init_Function();
  init_Option();
  init_Predicate();
  init_core2();
  init_stm();
  init_tRef();
  TEnqueueTypeId = /* @__PURE__ */ Symbol.for(TEnqueueSymbolKey);
  TDequeueTypeId = /* @__PURE__ */ Symbol.for(TDequeueSymbolKey);
  tDequeueVariance = {
    _Out: (_) => _
  };
  tEnqueueVariance = {
    _In: (_) => _
  };
  TQueueImpl = class TQueueImpl {
    ref;
    requestedCapacity;
    strategy;
    [TDequeueTypeId] = tDequeueVariance;
    [TEnqueueTypeId] = tEnqueueVariance;
    constructor(ref, requestedCapacity, strategy) {
      this.ref = ref;
      this.requestedCapacity = requestedCapacity;
      this.strategy = strategy;
    }
    capacity() {
      return this.requestedCapacity;
    }
    size = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      const queue = unsafeGet8(this.ref, runtime4.journal);
      if (queue === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      return succeed13(queue.length);
    });
    isFull = /* @__PURE__ */ map19(this.size, (size14) => size14 === this.requestedCapacity);
    isEmpty = /* @__PURE__ */ map19(this.size, (size14) => size14 === 0);
    shutdown = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      unsafeSet2(this.ref, undefined, runtime4.journal);
      return void_6;
    });
    isShutdown = /* @__PURE__ */ effect3((journal) => {
      const queue = unsafeGet8(this.ref, journal);
      return queue === undefined;
    });
    awaitShutdown = /* @__PURE__ */ flatMap13(this.isShutdown, (isShutdown3) => isShutdown3 ? void_6 : retry5);
    offer(value) {
      return withSTMRuntime((runtime4) => {
        const queue = pipe(this.ref, unsafeGet8(runtime4.journal));
        if (queue === undefined) {
          return interruptAs2(runtime4.fiberId);
        }
        if (queue.length < this.requestedCapacity) {
          queue.push(value);
          unsafeSet2(this.ref, queue, runtime4.journal);
          return succeed13(true);
        }
        switch (this.strategy._tag) {
          case OP_BACKPRESSURE_STRATEGY: {
            return retry5;
          }
          case OP_DROPPING_STRATEGY: {
            return succeed13(false);
          }
          case OP_SLIDING_STRATEGY: {
            if (queue.length === 0) {
              return succeed13(true);
            }
            queue.shift();
            queue.push(value);
            unsafeSet2(this.ref, queue, runtime4.journal);
            return succeed13(true);
          }
        }
      });
    }
    offerAll(iterable) {
      return withSTMRuntime((runtime4) => {
        const as6 = Array.from(iterable);
        const queue = unsafeGet8(this.ref, runtime4.journal);
        if (queue === undefined) {
          return interruptAs2(runtime4.fiberId);
        }
        if (queue.length + as6.length <= this.requestedCapacity) {
          unsafeSet2(this.ref, [...queue, ...as6], runtime4.journal);
          return succeed13(true);
        }
        switch (this.strategy._tag) {
          case OP_BACKPRESSURE_STRATEGY: {
            return retry5;
          }
          case OP_DROPPING_STRATEGY: {
            const forQueue = as6.slice(0, this.requestedCapacity - queue.length);
            unsafeSet2(this.ref, [...queue, ...forQueue], runtime4.journal);
            return succeed13(false);
          }
          case OP_SLIDING_STRATEGY: {
            const forQueue = as6.slice(0, this.requestedCapacity - queue.length);
            const toDrop = queue.length + forQueue.length - this.requestedCapacity;
            const newQueue = queue.slice(toDrop);
            unsafeSet2(this.ref, [...newQueue, ...forQueue], runtime4.journal);
            return succeed13(true);
          }
        }
      });
    }
    peek = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      const queue = unsafeGet8(this.ref, runtime4.journal);
      if (queue === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      if (queue.length === 0) {
        return retry5;
      }
      return succeed13(queue[0]);
    });
    peekOption = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      const queue = unsafeGet8(this.ref, runtime4.journal);
      if (queue === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      return succeed13(fromNullable(queue[0]));
    });
    take = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      const queue = unsafeGet8(this.ref, runtime4.journal);
      if (queue === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      if (queue.length === 0) {
        return retry5;
      }
      const dequeued = queue.shift();
      unsafeSet2(this.ref, queue, runtime4.journal);
      return succeed13(dequeued);
    });
    takeAll = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      const queue = unsafeGet8(this.ref, runtime4.journal);
      if (queue === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      unsafeSet2(this.ref, [], runtime4.journal);
      return succeed13(queue);
    });
    takeUpTo(max5) {
      return withSTMRuntime((runtime4) => {
        const queue = unsafeGet8(this.ref, runtime4.journal);
        if (queue === undefined) {
          return interruptAs2(runtime4.fiberId);
        }
        const [toTake, remaining] = splitAt2(unsafeFromArray(queue), max5);
        unsafeSet2(this.ref, Array.from(remaining), runtime4.journal);
        return succeed13(Array.from(toTake));
      });
    }
  };
});

// node_modules/effect/dist/esm/internal/stm/tPubSub.js
var TPubSubSymbolKey = "effect/TPubSub", TPubSubTypeId, AbsentValue2, makeNode2 = (head5, subscribers, tail) => ({
  head: head5,
  subscribers,
  tail
}), TPubSubImpl, TPubSubSubscriptionImpl;
var init_tPubSub = __esm(() => {
  init_Array();
  init_Effect();
  init_Function();
  init_HashSet();
  init_Option();
  init_core2();
  init_stm();
  init_tQueue();
  init_tRef();
  TPubSubTypeId = /* @__PURE__ */ Symbol.for(TPubSubSymbolKey);
  AbsentValue2 = /* @__PURE__ */ Symbol.for("effect/TPubSub/AbsentValue");
  TPubSubImpl = class TPubSubImpl {
    pubsubSize;
    publisherHead;
    publisherTail;
    requestedCapacity;
    strategy;
    subscriberCount;
    subscribers;
    [TPubSubTypeId] = {
      _A: (_) => _
    };
    [TEnqueueTypeId] = tEnqueueVariance;
    constructor(pubsubSize, publisherHead, publisherTail, requestedCapacity, strategy, subscriberCount, subscribers) {
      this.pubsubSize = pubsubSize;
      this.publisherHead = publisherHead;
      this.publisherTail = publisherTail;
      this.requestedCapacity = requestedCapacity;
      this.strategy = strategy;
      this.subscriberCount = subscriberCount;
      this.subscribers = subscribers;
    }
    isShutdown = /* @__PURE__ */ effect3((journal) => {
      const currentPublisherTail = unsafeGet8(this.publisherTail, journal);
      return currentPublisherTail === undefined;
    });
    awaitShutdown = /* @__PURE__ */ flatMap13(this.isShutdown, (isShutdown3) => isShutdown3 ? void_6 : retry5);
    capacity() {
      return this.requestedCapacity;
    }
    size = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      const currentPublisherTail = unsafeGet8(this.publisherTail, runtime4.journal);
      if (currentPublisherTail === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      return succeed13(unsafeGet8(this.pubsubSize, runtime4.journal));
    });
    isEmpty = /* @__PURE__ */ map19(this.size, (size14) => size14 === 0);
    isFull = /* @__PURE__ */ map19(this.size, (size14) => size14 === this.capacity());
    offer(value) {
      return withSTMRuntime((runtime4) => {
        const currentPublisherTail = unsafeGet8(this.publisherTail, runtime4.journal);
        if (currentPublisherTail === undefined) {
          return interruptAs2(runtime4.fiberId);
        }
        const currentSubscriberCount = unsafeGet8(this.subscriberCount, runtime4.journal);
        if (currentSubscriberCount === 0) {
          return succeed13(true);
        }
        const currentPubSubSize = unsafeGet8(this.pubsubSize, runtime4.journal);
        if (currentPubSubSize < this.requestedCapacity) {
          const updatedPublisherTail = new TRefImpl(undefined);
          const updatedNode = makeNode2(value, currentSubscriberCount, updatedPublisherTail);
          unsafeSet2(currentPublisherTail, updatedNode, runtime4.journal);
          unsafeSet2(this.publisherTail, updatedPublisherTail, runtime4.journal);
          unsafeSet2(this.pubsubSize, currentPubSubSize + 1, runtime4.journal);
          return succeed13(true);
        }
        switch (this.strategy._tag) {
          case OP_BACKPRESSURE_STRATEGY: {
            return retry5;
          }
          case OP_DROPPING_STRATEGY: {
            return succeed13(false);
          }
          case OP_SLIDING_STRATEGY: {
            if (this.requestedCapacity > 0) {
              let currentPublisherHead = unsafeGet8(this.publisherHead, runtime4.journal);
              let loop3 = true;
              while (loop3) {
                const node = unsafeGet8(currentPublisherHead, runtime4.journal);
                if (node === undefined) {
                  return retry5;
                }
                const head5 = node.head;
                const tail = node.tail;
                if (head5 !== AbsentValue2) {
                  const updatedNode2 = makeNode2(AbsentValue2, node.subscribers, node.tail);
                  unsafeSet2(currentPublisherHead, updatedNode2, runtime4.journal);
                  unsafeSet2(this.publisherHead, tail, runtime4.journal);
                  loop3 = false;
                } else {
                  currentPublisherHead = tail;
                }
              }
            }
            const updatedPublisherTail = new TRefImpl(undefined);
            const updatedNode = makeNode2(value, currentSubscriberCount, updatedPublisherTail);
            unsafeSet2(currentPublisherTail, updatedNode, runtime4.journal);
            unsafeSet2(this.publisherTail, updatedPublisherTail, runtime4.journal);
            return succeed13(true);
          }
        }
      });
    }
    offerAll(iterable) {
      return map19(forEach9(iterable, (a) => this.offer(a)), every(identity));
    }
    shutdown = /* @__PURE__ */ effect3((journal) => {
      const currentPublisherTail = unsafeGet8(this.publisherTail, journal);
      if (currentPublisherTail !== undefined) {
        unsafeSet2(this.publisherTail, undefined, journal);
        const currentSubscribers = unsafeGet8(this.subscribers, journal);
        forEach3(currentSubscribers, (subscriber) => {
          unsafeSet2(subscriber, undefined, journal);
        });
        unsafeSet2(this.subscribers, empty8(), journal);
      }
    });
  };
  TPubSubSubscriptionImpl = class TPubSubSubscriptionImpl {
    pubsubSize;
    publisherHead;
    requestedCapacity;
    subscriberHead;
    subscriberCount;
    subscribers;
    [TPubSubTypeId] = TPubSubTypeId;
    [TDequeueTypeId] = tDequeueVariance;
    constructor(pubsubSize, publisherHead, requestedCapacity, subscriberHead, subscriberCount, subscribers) {
      this.pubsubSize = pubsubSize;
      this.publisherHead = publisherHead;
      this.requestedCapacity = requestedCapacity;
      this.subscriberHead = subscriberHead;
      this.subscriberCount = subscriberCount;
      this.subscribers = subscribers;
    }
    isShutdown = /* @__PURE__ */ effect3((journal) => {
      const currentSubscriberHead = unsafeGet8(this.subscriberHead, journal);
      return currentSubscriberHead === undefined;
    });
    awaitShutdown = /* @__PURE__ */ flatMap13(this.isShutdown, (isShutdown3) => isShutdown3 ? void_6 : retry5);
    capacity() {
      return this.requestedCapacity;
    }
    size = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      let currentSubscriberHead = unsafeGet8(this.subscriberHead, runtime4.journal);
      if (currentSubscriberHead === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      let loop3 = true;
      let size14 = 0;
      while (loop3) {
        const node = unsafeGet8(currentSubscriberHead, runtime4.journal);
        if (node === undefined) {
          loop3 = false;
        } else {
          const head5 = node.head;
          const tail = node.tail;
          if (head5 !== AbsentValue2) {
            size14 = size14 + 1;
            if (size14 >= Number.MAX_SAFE_INTEGER) {
              loop3 = false;
            }
          }
          currentSubscriberHead = tail;
        }
      }
      return succeed13(size14);
    });
    isEmpty = /* @__PURE__ */ map19(this.size, (size14) => size14 === 0);
    isFull = /* @__PURE__ */ map19(this.size, (size14) => size14 === this.capacity());
    peek = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      let currentSubscriberHead = unsafeGet8(this.subscriberHead, runtime4.journal);
      if (currentSubscriberHead === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      let value = AbsentValue2;
      let loop3 = true;
      while (loop3) {
        const node = unsafeGet8(currentSubscriberHead, runtime4.journal);
        if (node === undefined) {
          return retry5;
        }
        const head5 = node.head;
        const tail = node.tail;
        if (head5 !== AbsentValue2) {
          value = head5;
          loop3 = false;
        } else {
          currentSubscriberHead = tail;
        }
      }
      return succeed13(value);
    });
    peekOption = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      let currentSubscriberHead = unsafeGet8(this.subscriberHead, runtime4.journal);
      if (currentSubscriberHead === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      let value = none2();
      let loop3 = true;
      while (loop3) {
        const node = unsafeGet8(currentSubscriberHead, runtime4.journal);
        if (node === undefined) {
          value = none2();
          loop3 = false;
        } else {
          const head5 = node.head;
          const tail = node.tail;
          if (head5 !== AbsentValue2) {
            value = some2(head5);
            loop3 = false;
          } else {
            currentSubscriberHead = tail;
          }
        }
      }
      return succeed13(value);
    });
    shutdown = /* @__PURE__ */ effect3((journal) => {
      let currentSubscriberHead = unsafeGet8(this.subscriberHead, journal);
      if (currentSubscriberHead !== undefined) {
        unsafeSet2(this.subscriberHead, undefined, journal);
        let loop3 = true;
        while (loop3) {
          const node = unsafeGet8(currentSubscriberHead, journal);
          if (node === undefined) {
            loop3 = false;
          } else {
            const head5 = node.head;
            const tail = node.tail;
            if (head5 !== AbsentValue2) {
              const subscribers = node.subscribers;
              if (subscribers === 1) {
                const size14 = unsafeGet8(this.pubsubSize, journal);
                const updatedNode = makeNode2(AbsentValue2, 0, tail);
                unsafeSet2(currentSubscriberHead, updatedNode, journal);
                unsafeSet2(this.publisherHead, tail, journal);
                unsafeSet2(this.pubsubSize, size14 - 1, journal);
              } else {
                const updatedNode = makeNode2(head5, subscribers - 1, tail);
                unsafeSet2(currentSubscriberHead, updatedNode, journal);
              }
            }
            currentSubscriberHead = tail;
          }
        }
        const currentSubscriberCount = unsafeGet8(this.subscriberCount, journal);
        unsafeSet2(this.subscriberCount, currentSubscriberCount - 1, journal);
        unsafeSet2(this.subscribers, remove4(unsafeGet8(this.subscribers, journal), this.subscriberHead), journal);
      }
    });
    take = /* @__PURE__ */ withSTMRuntime((runtime4) => {
      let currentSubscriberHead = unsafeGet8(this.subscriberHead, runtime4.journal);
      if (currentSubscriberHead === undefined) {
        return interruptAs2(runtime4.fiberId);
      }
      let value = AbsentValue2;
      let loop3 = true;
      while (loop3) {
        const node = unsafeGet8(currentSubscriberHead, runtime4.journal);
        if (node === undefined) {
          return retry5;
        }
        const head5 = node.head;
        const tail = node.tail;
        if (head5 !== AbsentValue2) {
          const subscribers = node.subscribers;
          if (subscribers === 1) {
            const size14 = unsafeGet8(this.pubsubSize, runtime4.journal);
            const updatedNode = makeNode2(AbsentValue2, 0, tail);
            unsafeSet2(currentSubscriberHead, updatedNode, runtime4.journal);
            unsafeSet2(this.publisherHead, tail, runtime4.journal);
            unsafeSet2(this.pubsubSize, size14 - 1, runtime4.journal);
          } else {
            const updatedNode = makeNode2(head5, subscribers - 1, tail);
            unsafeSet2(currentSubscriberHead, updatedNode, runtime4.journal);
          }
          unsafeSet2(this.subscriberHead, tail, runtime4.journal);
          value = head5;
          loop3 = false;
        } else {
          currentSubscriberHead = tail;
        }
      }
      return succeed13(value);
    });
    takeAll = /* @__PURE__ */ this.takeUpTo(Number.POSITIVE_INFINITY);
    takeUpTo(max5) {
      return withSTMRuntime((runtime4) => {
        let currentSubscriberHead = unsafeGet8(this.subscriberHead, runtime4.journal);
        if (currentSubscriberHead === undefined) {
          return interruptAs2(runtime4.fiberId);
        }
        const builder = [];
        let n = 0;
        while (n !== max5) {
          const node = unsafeGet8(currentSubscriberHead, runtime4.journal);
          if (node === undefined) {
            n = max5;
          } else {
            const head5 = node.head;
            const tail = node.tail;
            if (head5 !== AbsentValue2) {
              const subscribers = node.subscribers;
              if (subscribers === 1) {
                const size14 = unsafeGet8(this.pubsubSize, runtime4.journal);
                const updatedNode = makeNode2(AbsentValue2, 0, tail);
                unsafeSet2(currentSubscriberHead, updatedNode, runtime4.journal);
                unsafeSet2(this.publisherHead, tail, runtime4.journal);
                unsafeSet2(this.pubsubSize, size14 - 1, runtime4.journal);
              } else {
                const updatedNode = makeNode2(head5, subscribers - 1, tail);
                unsafeSet2(currentSubscriberHead, updatedNode, runtime4.journal);
              }
              builder.push(head5);
              n = n + 1;
            }
            currentSubscriberHead = tail;
          }
        }
        unsafeSet2(this.subscriberHead, currentSubscriberHead, runtime4.journal);
        return succeed13(builder);
      });
    }
  };
});

// node_modules/effect/dist/esm/TPubSub.js
var init_TPubSub = __esm(() => {
  init_tPubSub();
});

// node_modules/effect/dist/esm/TQueue.js
var init_TQueue = __esm(() => {
  init_tQueue();
});

// node_modules/effect/dist/esm/internal/ringBuffer.js
var init_ringBuffer = __esm(() => {
  init_Chunk();
  init_Function();
  init_Option();
});

// node_modules/effect/dist/esm/internal/stream/debounceState.js
var init_debounceState = () => {};

// node_modules/effect/dist/esm/internal/stream/emit.js
var init_emit = __esm(() => {
  init_Cause();
  init_Chunk();
  init_Effect();
  init_Exit();
  init_Function();
  init_Option();
});

// node_modules/effect/dist/esm/internal/stream/handoff.js
var init_handoff = __esm(() => {
  init_Deferred();
  init_Effect();
  init_Function();
  init_Option();
  init_Ref();
});
// node_modules/effect/dist/esm/internal/take.js
var init_take = __esm(() => {
  init_Cause();
  init_Chunk();
  init_Effect();
  init_Exit();
  init_Function();
  init_Option();
});

// node_modules/effect/dist/esm/internal/stream/pull.js
var init_pull = __esm(() => {
  init_Chunk();
  init_Effect();
  init_Option();
  init_Queue();
  init_take();
});

// node_modules/effect/dist/esm/internal/stream/sinkEndReason.js
var init_sinkEndReason = () => {};

// node_modules/effect/dist/esm/internal/stream/zipAllState.js
var init_zipAllState = () => {};

// node_modules/effect/dist/esm/internal/stream/zipChunksState.js
var init_zipChunksState = () => {};

// node_modules/effect/dist/esm/internal/stream.js
var init_stream = __esm(() => {
  init_Cause();
  init_Chunk();
  init_Clock();
  init_Context();
  init_Deferred();
  init_Duration();
  init_Effect();
  init_Either();
  init_Equal();
  init_Exit();
  init_Fiber();
  init_FiberRef();
  init_Function();
  init_Layer();
  init_MergeDecision();
  init_Option();
  init_Predicate();
  init_PubSub();
  init_Queue();
  init_RcRef();
  init_Ref();
  init_Runtime();
  init_Schedule();
  init_StreamHaltStrategy();
  init_TPubSub();
  init_TQueue();
  init_Tuple();
  init_channel();
  init_channelExecutor();
  init_mergeStrategy();
  init_core_stream();
  init_doNotation();
  init_ringBuffer();
  init_sink();
  init_debounceState();
  init_emit();
  init_haltStrategy();
  init_handoff();
  init_pull();
  init_sinkEndReason();
  init_zipAllState();
  init_zipChunksState();
  init_take();
  init_tracer();
});

// node_modules/effect/dist/esm/Channel.js
var init_Channel = __esm(() => {
  init_channel();
  init_core_stream();
  init_sink();
  init_stream();
});

// node_modules/effect/dist/esm/ChildExecutorDecision.js
var init_ChildExecutorDecision = __esm(() => {
  init_childExecutorDecision();
});

// node_modules/effect/dist/esm/ConfigError.js
var init_ConfigError = __esm(() => {
  init_configError();
});

// node_modules/effect/dist/esm/internal/redacted.js
var RedactedSymbolKey = "effect/Redacted", redactedRegistry, RedactedTypeId, proto12, isRedacted = (u) => hasProperty(u, RedactedTypeId);
var init_redacted = __esm(() => {
  init_Equal();
  init_Function();
  init_GlobalValue();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  redactedRegistry = /* @__PURE__ */ globalValue("effect/Redacted/redactedRegistry", () => new WeakMap);
  RedactedTypeId = /* @__PURE__ */ Symbol.for(RedactedSymbolKey);
  proto12 = {
    [RedactedTypeId]: {
      _A: (_) => _
    },
    pipe() {
      return pipeArguments(this, arguments);
    },
    toString() {
      return "<redacted>";
    },
    toJSON() {
      return "<redacted>";
    },
    [NodeInspectSymbol]() {
      return "<redacted>";
    },
    [symbol]() {
      return pipe(hash(RedactedSymbolKey), combine(hash(redactedRegistry.get(this))), cached(this));
    },
    [symbol2](that) {
      return isRedacted(that) && equals(redactedRegistry.get(this), redactedRegistry.get(that));
    }
  };
});

// node_modules/effect/dist/esm/internal/secret.js
var SecretSymbolKey = "effect/Secret", SecretTypeId, SecretProto;
var init_secret = __esm(() => {
  init_Array();
  init_Predicate();
  init_redacted();
  SecretTypeId = /* @__PURE__ */ Symbol.for(SecretSymbolKey);
  SecretProto = {
    ...proto12,
    [SecretTypeId]: SecretTypeId
  };
});

// node_modules/effect/dist/esm/internal/config.js
var ConfigSymbolKey = "effect/Config", ConfigTypeId, configVariance, proto13;
var init_config2 = __esm(() => {
  init_Chunk();
  init_ConfigError();
  init_Duration();
  init_Either();
  init_Function();
  init_HashSet();
  init_Option();
  init_Predicate();
  init_configError();
  init_core();
  init_defaultServices();
  init_effectable();
  init_redacted();
  init_secret();
  ConfigTypeId = /* @__PURE__ */ Symbol.for(ConfigSymbolKey);
  configVariance = {
    _A: (_) => _
  };
  proto13 = {
    ...CommitPrototype,
    [ConfigTypeId]: configVariance,
    commit() {
      return config(this);
    }
  };
});

// node_modules/effect/dist/esm/Config.js
var init_Config = __esm(() => {
  init_config2();
});

// node_modules/effect/dist/esm/ConfigProvider.js
var init_ConfigProvider = __esm(() => {
  init_configProvider();
});

// node_modules/effect/dist/esm/ConfigProviderPathPatch.js
var init_ConfigProviderPathPatch = __esm(() => {
  init_pathPatch();
});

// node_modules/effect/dist/esm/Console.js
var init_Console = __esm(() => {
  init_console2();
  init_console();
});

// node_modules/effect/dist/esm/DateTime.js
var init_DateTime = __esm(() => {
  init_Context();
  init_Effect();
  init_Function();
  init_dateTime();
  init_Layer();
});

// node_modules/effect/dist/esm/DefaultServices.js
var init_DefaultServices = __esm(() => {
  init_defaultServices();
});

// node_modules/effect/dist/esm/internal/encoding/common.js
var init_common = __esm(() => {
  init_Predicate();
});

// node_modules/effect/dist/esm/internal/encoding/base64.js
var init_base64 = __esm(() => {
  init_Either();
  init_common();
});

// node_modules/effect/dist/esm/internal/encoding/base64Url.js
var init_base64Url = __esm(() => {
  init_Either();
  init_base64();
  init_common();
});

// node_modules/effect/dist/esm/internal/encoding/hex.js
var init_hex = __esm(() => {
  init_Either();
  init_common();
});

// node_modules/effect/dist/esm/Encoding.js
var init_Encoding = __esm(() => {
  init_Either();
  init_base64();
  init_base64Url();
  init_common();
  init_hex();
});

// node_modules/effect/dist/esm/FiberHandle.js
var TypeId20, Proto3;
var init_FiberHandle = __esm(() => {
  init_Cause();
  init_Deferred();
  init_Effect();
  init_Exit();
  init_Fiber();
  init_FiberId();
  init_Function();
  init_HashSet();
  init_Inspectable();
  init_Option();
  init_Predicate();
  init_Runtime();
  TypeId20 = /* @__PURE__ */ Symbol.for("effect/FiberHandle");
  Proto3 = {
    [TypeId20]: TypeId20,
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "FiberHandle",
        state: this.state
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/FiberMap.js
var TypeId21, Proto4;
var init_FiberMap = __esm(() => {
  init_Cause();
  init_Deferred();
  init_Effect();
  init_Exit();
  init_Fiber();
  init_FiberId();
  init_Function();
  init_HashSet();
  init_Inspectable();
  init_Iterable();
  init_MutableHashMap();
  init_Option();
  init_Predicate();
  init_Runtime();
  TypeId21 = /* @__PURE__ */ Symbol.for("effect/FiberMap");
  Proto4 = {
    [TypeId21]: TypeId21,
    [Symbol.iterator]() {
      if (this.state._tag === "Closed") {
        return empty();
      }
      return this.state.backing[Symbol.iterator]();
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "FiberMap",
        state: this.state
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/FiberSet.js
var TypeId22, Proto5;
var init_FiberSet = __esm(() => {
  init_Cause();
  init_Deferred();
  init_Effect();
  init_Exit();
  init_Fiber();
  init_FiberId();
  init_Function();
  init_HashSet();
  init_Inspectable();
  init_Iterable();
  init_Predicate();
  init_Runtime();
  TypeId22 = /* @__PURE__ */ Symbol.for("effect/FiberSet");
  Proto5 = {
    [TypeId22]: TypeId22,
    [Symbol.iterator]() {
      if (this.state._tag === "Closed") {
        return empty();
      }
      return this.state.backing[Symbol.iterator]();
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "FiberMap",
        state: this.state
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/groupBy.js
var init_groupBy = __esm(() => {
  init_Cause();
  init_Chunk();
  init_Deferred();
  init_Effect();
  init_Effectable();
  init_Exit();
  init_Function();
  init_Option();
  init_Predicate();
  init_Queue();
  init_Ref();
  init_Scope();
  init_channel();
  init_channelExecutor();
  init_core_stream();
  init_stream();
  init_take();
});

// node_modules/effect/dist/esm/GroupBy.js
var init_GroupBy = __esm(() => {
  init_groupBy();
});

// node_modules/effect/dist/esm/HKT.js
var init_HKT = () => {};

// node_modules/effect/dist/esm/JSONSchema.js
var init_JSONSchema = __esm(() => {
  init_errors();
  init_Option();
  init_Predicate();
  init_Record();
  init_SchemaAST();
});

// node_modules/effect/dist/esm/internal/pool.js
var PoolTypeId, poolVariance, PoolImpl, reportUnhandledError = (cause3) => withFiberRuntime((fiber) => {
  const unhandledLogLevel = fiber.getFiberRef(currentUnhandledErrorLogLevel);
  if (unhandledLogLevel._tag === "Some") {
    fiber.log("Unhandled error in pool finalizer", cause3, unhandledLogLevel);
  }
  return void_;
});
var init_pool = __esm(() => {
  init_Context();
  init_Duration();
  init_Effectable();
  init_Function();
  init_Iterable();
  init_Option();
  init_Predicate();
  init_core_effect();
  init_core();
  init_defaultServices();
  init_circular();
  init_fiberRuntime();
  init_queue();
  PoolTypeId = /* @__PURE__ */ Symbol.for("effect/Pool");
  poolVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
  PoolImpl = class PoolImpl extends Class {
    scope;
    acquire;
    concurrency;
    minSize;
    maxSize;
    strategy;
    targetUtilization;
    [PoolTypeId];
    isShuttingDown = false;
    semaphore;
    items = /* @__PURE__ */ new Set;
    available = /* @__PURE__ */ new Set;
    availableLatch = /* @__PURE__ */ unsafeMakeLatch(false);
    invalidated = /* @__PURE__ */ new Set;
    waiters = 0;
    constructor(scope5, acquire, concurrency, minSize, maxSize, strategy, targetUtilization) {
      super();
      this.scope = scope5;
      this.acquire = acquire;
      this.concurrency = concurrency;
      this.minSize = minSize;
      this.maxSize = maxSize;
      this.strategy = strategy;
      this.targetUtilization = targetUtilization;
      this[PoolTypeId] = poolVariance;
      this.semaphore = unsafeMakeSemaphore(concurrency * maxSize);
    }
    allocate = /* @__PURE__ */ acquireUseRelease(/* @__PURE__ */ scopeMake(), (scope5) => this.acquire.pipe(scopeExtend(scope5), exit, flatMap7((exit3) => {
      const item = {
        exit: exit3,
        finalizer: catchAllCause(scope5.close(exit3), reportUnhandledError),
        refCount: 0,
        disableReclaim: false
      };
      this.items.add(item);
      this.available.add(item);
      return as(exit3._tag === "Success" ? this.strategy.onAcquire(item) : zipRight(item.finalizer, this.strategy.onAcquire(item)), item);
    })), (scope5, exit3) => exit3._tag === "Failure" ? scope5.close(exit3) : void_);
    get currentUsage() {
      let count4 = this.waiters;
      for (const item of this.items) {
        count4 += item.refCount;
      }
      return count4;
    }
    get targetSize() {
      if (this.isShuttingDown)
        return 0;
      const utilization = this.currentUsage / this.targetUtilization;
      const target = Math.ceil(utilization / this.concurrency);
      return Math.min(Math.max(this.minSize, target), this.maxSize);
    }
    get activeSize() {
      return this.items.size - this.invalidated.size;
    }
    resizeLoop = /* @__PURE__ */ suspend(() => {
      if (this.activeSize >= this.targetSize) {
        return void_;
      }
      return this.strategy.reclaim(this).pipe(flatMap7(match2({
        onNone: () => this.allocate,
        onSome: succeed
      })), zipLeft(this.availableLatch.open), flatMap7((item) => item.exit._tag === "Success" ? this.resizeLoop : void_));
    });
    resizeSemaphore = /* @__PURE__ */ unsafeMakeSemaphore(1);
    resize = /* @__PURE__ */ this.resizeSemaphore.withPermits(1)(this.resizeLoop);
    getPoolItem = /* @__PURE__ */ uninterruptibleMask((restore) => restore(this.semaphore.take(1)).pipe(zipRight(scopeTag), flatMap7((scope5) => suspend(() => {
      this.waiters++;
      if (this.isShuttingDown) {
        return interrupt2;
      } else if (this.targetSize > this.activeSize) {
        const self = this;
        return flatMap7(this.resizeSemaphore.withPermitsIfAvailable(1)(forkIn(interruptible2(this.resize), this.scope)), function loop() {
          if (self.isShuttingDown) {
            return interrupt2;
          } else if (self.available.size > 0) {
            return succeed(unsafeHead(self.available));
          }
          self.availableLatch.unsafeClose();
          return flatMap7(self.availableLatch.await, loop);
        });
      }
      return succeed(unsafeHead(this.available));
    }).pipe(ensuring(sync(() => this.waiters--)), tap((item) => {
      if (item.exit._tag === "Failure") {
        this.items.delete(item);
        this.invalidated.delete(item);
        this.available.delete(item);
        return this.semaphore.release(1);
      }
      item.refCount++;
      this.available.delete(item);
      if (item.refCount < this.concurrency) {
        this.available.add(item);
      }
      return scope5.addFinalizer(() => zipRight(suspend(() => {
        item.refCount--;
        if (this.invalidated.has(item)) {
          return this.invalidatePoolItem(item);
        }
        this.available.add(item);
        return exitVoid;
      }), this.semaphore.release(1)));
    }), onInterrupt(() => this.semaphore.release(1))))));
    commit() {
      return this.get;
    }
    get = /* @__PURE__ */ flatMap7(/* @__PURE__ */ suspend(() => this.isShuttingDown ? interrupt2 : this.getPoolItem), (_) => _.exit);
    invalidate(item) {
      return suspend(() => {
        if (this.isShuttingDown)
          return void_;
        for (const poolItem of this.items) {
          if (poolItem.exit._tag === "Success" && poolItem.exit.value === item) {
            poolItem.disableReclaim = true;
            return uninterruptible(this.invalidatePoolItem(poolItem));
          }
        }
        return void_;
      });
    }
    invalidatePoolItem(poolItem) {
      return suspend(() => {
        if (!this.items.has(poolItem)) {
          return void_;
        } else if (poolItem.refCount === 0) {
          this.items.delete(poolItem);
          this.available.delete(poolItem);
          this.invalidated.delete(poolItem);
          return zipRight(poolItem.finalizer, forkIn(interruptible2(this.resize), this.scope));
        }
        this.invalidated.add(poolItem);
        this.available.delete(poolItem);
        return void_;
      });
    }
    get shutdown() {
      return suspend(() => {
        if (this.isShuttingDown)
          return void_;
        this.isShuttingDown = true;
        const size16 = this.items.size;
        const semaphore = unsafeMakeSemaphore(size16);
        return forEachSequentialDiscard(this.items, (item) => {
          if (item.refCount > 0) {
            item.finalizer = zipLeft(item.finalizer, semaphore.release(1));
            this.invalidated.add(item);
            return semaphore.take(1);
          }
          this.items.delete(item);
          this.available.delete(item);
          this.invalidated.delete(item);
          return item.finalizer;
        }).pipe(zipRight(this.semaphore.releaseAll), zipRight(this.availableLatch.open), zipRight(semaphore.take(size16)));
      });
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/keyedPool.js
var init_keyedPool = __esm(() => {
  init_Duration();
  init_Equal();
  init_Function();
  init_Hash();
  init_HashMap();
  init_MutableRef();
  init_Option();
  init_Predicate();
  init_core();
  init_fiberRuntime();
  init_pool();
});

// node_modules/effect/dist/esm/KeyedPool.js
var init_KeyedPool = __esm(() => {
  init_keyedPool();
});

// node_modules/effect/dist/esm/internal/rcMap.js
var init_rcMap = __esm(() => {
  init_Context();
  init_Duration();
  init_Function();
  init_MutableHashMap();
  init_core_effect();
  init_core();
  init_circular();
  init_fiberRuntime();
});

// node_modules/effect/dist/esm/RcMap.js
var init_RcMap = __esm(() => {
  init_rcMap();
});

// node_modules/effect/dist/esm/LayerMap.js
var init_LayerMap = __esm(() => {
  init_Context();
  init_Effect();
  init_Function();
  init_Layer();
  init_RcMap();
  init_Scope();
});

// node_modules/effect/dist/esm/internal/logger-circular.js
var init_logger_circular = __esm(() => {
  init_Cause();
  init_Function();
  init_HashMap();
  init_List();
  init_core();
  init_fiberId();
  init_fiberRefs();
});

// node_modules/effect/dist/esm/Logger.js
var init_Logger = __esm(() => {
  init_fiberRuntime();
  init_circular3();
  init_logger_circular();
  init_logger();
});

// node_modules/effect/dist/esm/internal/mailbox.js
var init_mailbox = __esm(() => {
  init_Array();
  init_Cause();
  init_Chunk();
  init_Effectable();
  init_Function();
  init_Inspectable();
  init_Iterable();
  init_Option();
  init_Predicate();
  init_channel();
  init_channelExecutor();
  init_core_stream();
  init_core();
  init_circular();
  init_fiberRuntime();
  init_stream();
});

// node_modules/effect/dist/esm/Mailbox.js
var init_Mailbox = __esm(() => {
  init_mailbox();
  init_Predicate();
});

// node_modules/effect/dist/esm/internal/managedRuntime.js
var ManagedRuntimeProto;
var init_managedRuntime = __esm(() => {
  init_Effectable();
  init_Predicate();
  init_Scope();
  init_core();
  init_fiberRuntime();
  init_layer();
  init_circular2();
  init_runtime();
  ManagedRuntimeProto = {
    ...CommitPrototype2,
    [TypeId18]: TypeId18,
    pipe() {
      return pipeArguments(this, arguments);
    },
    commit() {
      return this.runtimeEffect;
    }
  };
});

// node_modules/effect/dist/esm/ManagedRuntime.js
var init_ManagedRuntime = __esm(() => {
  init_managedRuntime();
  init_circular2();
});

// node_modules/effect/dist/esm/internal/matcher.js
function makeTypeMatcher(cases) {
  const matcher = Object.create(TypeMatcherProto);
  matcher.cases = cases;
  return matcher;
}
function makeValueMatcher(provided, value) {
  const matcher = Object.create(ValueMatcherProto);
  matcher.provided = provided;
  matcher.value = value;
  return matcher;
}
var TypeId25, TypeMatcherProto, ValueMatcherProto;
var init_matcher = __esm(() => {
  init_Either();
  init_Function();
  init_Option();
  TypeId25 = /* @__PURE__ */ Symbol.for("@effect/matcher/Matcher");
  TypeMatcherProto = {
    [TypeId25]: {
      _input: identity,
      _filters: identity,
      _remaining: identity,
      _result: identity,
      _return: identity
    },
    _tag: "TypeMatcher",
    add(_case) {
      return makeTypeMatcher([...this.cases, _case]);
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  ValueMatcherProto = {
    [TypeId25]: {
      _input: identity,
      _filters: identity,
      _result: identity,
      _return: identity
    },
    _tag: "ValueMatcher",
    add(_case) {
      if (this.value._tag === "Right") {
        return this;
      }
      if (_case._tag === "When" && _case.guard(this.provided) === true) {
        return makeValueMatcher(this.provided, right2(_case.evaluate(this.provided)));
      } else if (_case._tag === "Not" && _case.guard(this.provided) === false) {
        return makeValueMatcher(this.provided, right2(_case.evaluate(this.provided)));
      }
      return this;
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/Match.js
var init_Match = __esm(() => {
  init_matcher();
  init_Predicate();
});

// node_modules/effect/dist/esm/MergeState.js
var init_MergeState = __esm(() => {
  init_mergeState();
});

// node_modules/effect/dist/esm/MergeStrategy.js
var init_MergeStrategy = __esm(() => {
  init_mergeStrategy();
});

// node_modules/effect/dist/esm/Metric.js
var init_Metric = __esm(() => {
  init_fiberRuntime();
  init_metric();
});

// node_modules/effect/dist/esm/MetricBoundaries.js
var init_MetricBoundaries = __esm(() => {
  init_boundaries();
});

// node_modules/effect/dist/esm/MetricHook.js
var init_MetricHook = __esm(() => {
  init_hook();
});

// node_modules/effect/dist/esm/MetricKey.js
var init_MetricKey = __esm(() => {
  init_key();
});

// node_modules/effect/dist/esm/MetricKeyType.js
var init_MetricKeyType = __esm(() => {
  init_keyType();
});

// node_modules/effect/dist/esm/MetricLabel.js
var init_MetricLabel = __esm(() => {
  init_label();
});

// node_modules/effect/dist/esm/MetricPair.js
var init_MetricPair = __esm(() => {
  init_pair();
});

// node_modules/effect/dist/esm/internal/metric/polling.js
var init_polling = __esm(() => {
  init_Function();
  init_core();
  init_circular();
  init_metric();
  init_schedule();
});

// node_modules/effect/dist/esm/MetricPolling.js
var init_MetricPolling = __esm(() => {
  init_polling();
});

// node_modules/effect/dist/esm/MetricRegistry.js
var init_MetricRegistry = __esm(() => {
  init_registry();
});

// node_modules/effect/dist/esm/MetricState.js
var init_MetricState = __esm(() => {
  init_state();
});

// node_modules/effect/dist/esm/ModuleVersion.js
var init_ModuleVersion = () => {};

// node_modules/effect/dist/esm/MutableHashSet.js
var TypeId26, MutableHashSetProto;
var init_MutableHashSet = __esm(() => {
  init_Function();
  init_Inspectable();
  init_MutableHashMap();
  TypeId26 = /* @__PURE__ */ Symbol.for("effect/MutableHashSet");
  MutableHashSetProto = {
    [TypeId26]: TypeId26,
    [Symbol.iterator]() {
      return Array.from(this.keyMap).map(([_]) => _)[Symbol.iterator]();
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableHashSet",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});
// node_modules/effect/dist/esm/Ordering.js
var init_Ordering = __esm(() => {
  init_Function();
});

// node_modules/effect/dist/esm/ParseResult.js
class Pointer {
  path;
  actual;
  issue;
  _tag = "Pointer";
  constructor(path, actual, issue) {
    this.path = path;
    this.actual = actual;
    this.issue = issue;
  }
}

class Unexpected {
  actual;
  message;
  _tag = "Unexpected";
  constructor(actual, message) {
    this.actual = actual;
    this.message = message;
  }
}

class Missing {
  ast;
  message;
  _tag = "Missing";
  actual = undefined;
  constructor(ast, message) {
    this.ast = ast;
    this.message = message;
  }
}

class Composite2 {
  ast;
  actual;
  issues;
  output;
  _tag = "Composite";
  constructor(ast, actual, issues, output) {
    this.ast = ast;
    this.actual = actual;
    this.issues = issues;
    this.output = output;
  }
}

class Refinement2 {
  ast;
  actual;
  kind;
  issue;
  _tag = "Refinement";
  constructor(ast, actual, kind, issue) {
    this.ast = ast;
    this.actual = actual;
    this.kind = kind;
    this.issue = issue;
  }
}

class Transformation {
  ast;
  actual;
  kind;
  issue;
  _tag = "Transformation";
  constructor(ast, actual, kind, issue) {
    this.ast = ast;
    this.actual = actual;
    this.kind = kind;
    this.issue = issue;
  }
}

class Type2 {
  ast;
  actual;
  message;
  _tag = "Type";
  constructor(ast, actual, message) {
    this.ast = ast;
    this.actual = actual;
    this.message = message;
  }
}

class Forbidden {
  ast;
  actual;
  message;
  _tag = "Forbidden";
  constructor(ast, actual, message) {
    this.ast = ast;
    this.actual = actual;
    this.message = message;
  }
}
function sortByIndex(es) {
  return es.sort(compare).map((t) => t[1]);
}
function getRefinementExpected(ast) {
  return getDescriptionAnnotation(ast).pipe(orElse(() => getTitleAnnotation(ast)), orElse(() => getAutoTitleAnnotation(ast)), orElse(() => getIdentifierAnnotation(ast)), getOrElse(() => `{ ${ast.from} | filter }`));
}
function getDefaultTypeMessage(issue) {
  if (issue.message !== undefined) {
    return issue.message;
  }
  const expected = isRefinement(issue.ast) ? getRefinementExpected(issue.ast) : String(issue.ast);
  return `Expected ${expected}, actual ${formatUnknown(issue.actual)}`;
}
var ParseErrorTypeId, ParseError, parseError = (issue) => new ParseError({
  issue
}), succeed17, fail16, isEither4, flatMap16, map25, mapError6, orElse11, mergeInternalOptions = (options, overrideOptions) => {
  if (overrideOptions === undefined || isNumber(overrideOptions)) {
    return options;
  }
  if (options === undefined) {
    return overrideOptions;
  }
  return {
    ...options,
    ...overrideOptions
  };
}, getEither = (ast, isDecoding, options) => {
  const parser = goMemo(ast, isDecoding);
  return (u, overrideOptions) => parser(u, mergeInternalOptions(options, overrideOptions));
}, getSync = (ast, isDecoding, options) => {
  const parser = getEither(ast, isDecoding, options);
  return (input, overrideOptions) => getOrThrowWith(parser(input, overrideOptions), parseError);
}, validateSync = (schema, options) => getSync(typeAST(schema.ast), true, options), decodeMemoMap, encodeMemoMap, goMemo = (ast, isDecoding) => {
  const memoMap = isDecoding ? decodeMemoMap : encodeMemoMap;
  const memo = memoMap.get(ast);
  if (memo) {
    return memo;
  }
  const raw = go(ast, isDecoding);
  const parseOptionsAnnotation = getParseOptionsAnnotation(ast);
  const parserWithOptions = isSome2(parseOptionsAnnotation) ? (i, options) => raw(i, mergeInternalOptions(options, parseOptionsAnnotation.value)) : raw;
  const decodingFallbackAnnotation = getDecodingFallbackAnnotation(ast);
  const parser = isDecoding && isSome2(decodingFallbackAnnotation) ? (i, options) => handleForbidden(orElse11(parserWithOptions(i, options), decodingFallbackAnnotation.value), ast, i, options) : parserWithOptions;
  memoMap.set(ast, parser);
  return parser;
}, getConcurrency = (ast) => getOrUndefined(getConcurrencyAnnotation(ast)), getBatching = (ast) => getOrUndefined(getBatchingAnnotation(ast)), go = (ast, isDecoding) => {
  switch (ast._tag) {
    case "Refinement": {
      if (isDecoding) {
        const from = goMemo(ast.from, true);
        return (i, options) => {
          options = options ?? defaultParseOption;
          const allErrors = options?.errors === "all";
          const result = flatMap16(orElse11(from(i, options), (ef) => {
            const issue = new Refinement2(ast, i, "From", ef);
            if (allErrors && hasStableFilter(ast) && isComposite2(ef)) {
              return match2(ast.filter(i, options, ast), {
                onNone: () => left2(issue),
                onSome: (ep) => left2(new Composite2(ast, i, [issue, new Refinement2(ast, i, "Predicate", ep)]))
              });
            }
            return left2(issue);
          }), (a) => match2(ast.filter(a, options, ast), {
            onNone: () => right2(a),
            onSome: (ep) => left2(new Refinement2(ast, i, "Predicate", ep))
          }));
          return handleForbidden(result, ast, i, options);
        };
      } else {
        const from = goMemo(typeAST(ast), true);
        const to = goMemo(dropRightRefinement(ast.from), false);
        return (i, options) => handleForbidden(flatMap16(from(i, options), (a) => to(a, options)), ast, i, options);
      }
    }
    case "Transformation": {
      const transform2 = getFinalTransformation(ast.transformation, isDecoding);
      const from = isDecoding ? goMemo(ast.from, true) : goMemo(ast.to, false);
      const to = isDecoding ? goMemo(ast.to, true) : goMemo(ast.from, false);
      return (i, options) => handleForbidden(flatMap16(mapError6(from(i, options), (e) => new Transformation(ast, i, isDecoding ? "Encoded" : "Type", e)), (a) => flatMap16(mapError6(transform2(a, options ?? defaultParseOption, ast, i), (e) => new Transformation(ast, i, "Transformation", e)), (i2) => mapError6(to(i2, options), (e) => new Transformation(ast, i, isDecoding ? "Type" : "Encoded", e)))), ast, i, options);
    }
    case "Declaration": {
      const parse2 = isDecoding ? ast.decodeUnknown(...ast.typeParameters) : ast.encodeUnknown(...ast.typeParameters);
      return (i, options) => handleForbidden(parse2(i, options ?? defaultParseOption, ast), ast, i, options);
    }
    case "Literal":
      return fromRefinement(ast, (u) => u === ast.literal);
    case "UniqueSymbol":
      return fromRefinement(ast, (u) => u === ast.symbol);
    case "UndefinedKeyword":
      return fromRefinement(ast, isUndefined);
    case "NeverKeyword":
      return fromRefinement(ast, isNever);
    case "UnknownKeyword":
    case "AnyKeyword":
    case "VoidKeyword":
      return right2;
    case "StringKeyword":
      return fromRefinement(ast, isString);
    case "NumberKeyword":
      return fromRefinement(ast, isNumber);
    case "BooleanKeyword":
      return fromRefinement(ast, isBoolean);
    case "BigIntKeyword":
      return fromRefinement(ast, isBigInt);
    case "SymbolKeyword":
      return fromRefinement(ast, isSymbol);
    case "ObjectKeyword":
      return fromRefinement(ast, isObject);
    case "Enums":
      return fromRefinement(ast, (u) => ast.enums.some(([_, value3]) => value3 === u));
    case "TemplateLiteral": {
      const regex = getTemplateLiteralRegExp(ast);
      return fromRefinement(ast, (u) => isString(u) && regex.test(u));
    }
    case "TupleType": {
      const elements = ast.elements.map((e) => goMemo(e.type, isDecoding));
      const rest = ast.rest.map((annotatedAST) => goMemo(annotatedAST.type, isDecoding));
      let requiredTypes = ast.elements.filter((e) => !e.isOptional);
      if (ast.rest.length > 0) {
        requiredTypes = requiredTypes.concat(ast.rest.slice(1));
      }
      const requiredLen = requiredTypes.length;
      const expectedIndexes = ast.elements.length > 0 ? ast.elements.map((_, i) => i).join(" | ") : "never";
      const concurrency = getConcurrency(ast);
      const batching = getBatching(ast);
      return (input, options) => {
        if (!isArray(input)) {
          return left2(new Type2(ast, input));
        }
        const allErrors = options?.errors === "all";
        const es = [];
        let stepKey = 0;
        const output = [];
        const len = input.length;
        for (let i2 = len;i2 <= requiredLen - 1; i2++) {
          const e = new Pointer(i2, input, new Missing(requiredTypes[i2 - len]));
          if (allErrors) {
            es.push([stepKey++, e]);
            continue;
          } else {
            return left2(new Composite2(ast, input, e, output));
          }
        }
        if (ast.rest.length === 0) {
          for (let i2 = ast.elements.length;i2 <= len - 1; i2++) {
            const e = new Pointer(i2, input, new Unexpected(input[i2], `is unexpected, expected: ${expectedIndexes}`));
            if (allErrors) {
              es.push([stepKey++, e]);
              continue;
            } else {
              return left2(new Composite2(ast, input, e, output));
            }
          }
        }
        let i = 0;
        let queue = undefined;
        for (;i < elements.length; i++) {
          if (len < i + 1) {
            if (ast.elements[i].isOptional) {
              continue;
            }
          } else {
            const parser = elements[i];
            const te = parser(input[i], options);
            if (isEither4(te)) {
              if (isLeft2(te)) {
                const e = new Pointer(i, input, te.left);
                if (allErrors) {
                  es.push([stepKey++, e]);
                  continue;
                } else {
                  return left2(new Composite2(ast, input, e, sortByIndex(output)));
                }
              }
              output.push([stepKey++, te.right]);
            } else {
              const nk = stepKey++;
              const index = i;
              if (!queue) {
                queue = [];
              }
              queue.push(({
                es: es2,
                output: output2
              }) => flatMap10(either3(te), (t) => {
                if (isLeft2(t)) {
                  const e = new Pointer(index, input, t.left);
                  if (allErrors) {
                    es2.push([nk, e]);
                    return _void;
                  } else {
                    return left2(new Composite2(ast, input, e, sortByIndex(output2)));
                  }
                }
                output2.push([nk, t.right]);
                return _void;
              }));
            }
          }
        }
        if (isNonEmptyReadonlyArray(rest)) {
          const [head7, ...tail] = rest;
          for (;i < len - tail.length; i++) {
            const te = head7(input[i], options);
            if (isEither4(te)) {
              if (isLeft2(te)) {
                const e = new Pointer(i, input, te.left);
                if (allErrors) {
                  es.push([stepKey++, e]);
                  continue;
                } else {
                  return left2(new Composite2(ast, input, e, sortByIndex(output)));
                }
              } else {
                output.push([stepKey++, te.right]);
              }
            } else {
              const nk = stepKey++;
              const index = i;
              if (!queue) {
                queue = [];
              }
              queue.push(({
                es: es2,
                output: output2
              }) => flatMap10(either3(te), (t) => {
                if (isLeft2(t)) {
                  const e = new Pointer(index, input, t.left);
                  if (allErrors) {
                    es2.push([nk, e]);
                    return _void;
                  } else {
                    return left2(new Composite2(ast, input, e, sortByIndex(output2)));
                  }
                } else {
                  output2.push([nk, t.right]);
                  return _void;
                }
              }));
            }
          }
          for (let j = 0;j < tail.length; j++) {
            i += j;
            if (len < i + 1) {
              continue;
            } else {
              const te = tail[j](input[i], options);
              if (isEither4(te)) {
                if (isLeft2(te)) {
                  const e = new Pointer(i, input, te.left);
                  if (allErrors) {
                    es.push([stepKey++, e]);
                    continue;
                  } else {
                    return left2(new Composite2(ast, input, e, sortByIndex(output)));
                  }
                }
                output.push([stepKey++, te.right]);
              } else {
                const nk = stepKey++;
                const index = i;
                if (!queue) {
                  queue = [];
                }
                queue.push(({
                  es: es2,
                  output: output2
                }) => flatMap10(either3(te), (t) => {
                  if (isLeft2(t)) {
                    const e = new Pointer(index, input, t.left);
                    if (allErrors) {
                      es2.push([nk, e]);
                      return _void;
                    } else {
                      return left2(new Composite2(ast, input, e, sortByIndex(output2)));
                    }
                  }
                  output2.push([nk, t.right]);
                  return _void;
                }));
              }
            }
          }
        }
        const computeResult = ({
          es: es2,
          output: output2
        }) => isNonEmptyArray2(es2) ? left2(new Composite2(ast, input, sortByIndex(es2), sortByIndex(output2))) : right2(sortByIndex(output2));
        if (queue && queue.length > 0) {
          const cqueue = queue;
          return suspend3(() => {
            const state = {
              es: copy(es),
              output: copy(output)
            };
            return flatMap10(forEach8(cqueue, (f) => f(state), {
              concurrency,
              batching,
              discard: true
            }), () => computeResult(state));
          });
        }
        return computeResult({
          output,
          es
        });
      };
    }
    case "TypeLiteral": {
      if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) {
        return fromRefinement(ast, isNotNullable);
      }
      const propertySignatures = [];
      const expectedKeysMap = {};
      const expectedKeys = [];
      for (const ps of ast.propertySignatures) {
        propertySignatures.push([goMemo(ps.type, isDecoding), ps]);
        expectedKeysMap[ps.name] = null;
        expectedKeys.push(ps.name);
      }
      const indexSignatures = ast.indexSignatures.map((is2) => [goMemo(is2.parameter, isDecoding), goMemo(is2.type, isDecoding), is2.parameter]);
      const expectedAST = Union.make(ast.indexSignatures.map((is2) => is2.parameter).concat(expectedKeys.map((key) => isSymbol(key) ? new UniqueSymbol(key) : new Literal(key))));
      const expected = goMemo(expectedAST, isDecoding);
      const concurrency = getConcurrency(ast);
      const batching = getBatching(ast);
      return (input, options) => {
        if (!isRecord(input)) {
          return left2(new Type2(ast, input));
        }
        const allErrors = options?.errors === "all";
        const es = [];
        let stepKey = 0;
        const onExcessPropertyError = options?.onExcessProperty === "error";
        const onExcessPropertyPreserve = options?.onExcessProperty === "preserve";
        const output = {};
        let inputKeys;
        if (onExcessPropertyError || onExcessPropertyPreserve) {
          inputKeys = ownKeys(input);
          for (const key of inputKeys) {
            const te = expected(key, options);
            if (isEither4(te) && isLeft2(te)) {
              if (onExcessPropertyError) {
                const e = new Pointer(key, input, new Unexpected(input[key], `is unexpected, expected: ${String(expectedAST)}`));
                if (allErrors) {
                  es.push([stepKey++, e]);
                  continue;
                } else {
                  return left2(new Composite2(ast, input, e, output));
                }
              } else {
                output[key] = input[key];
              }
            }
          }
        }
        let queue = undefined;
        const isExact = options?.exact === true;
        for (let i = 0;i < propertySignatures.length; i++) {
          const ps = propertySignatures[i][1];
          const name = ps.name;
          const hasKey = Object.prototype.hasOwnProperty.call(input, name);
          if (!hasKey) {
            if (ps.isOptional) {
              continue;
            } else if (isExact) {
              const e = new Pointer(name, input, new Missing(ps));
              if (allErrors) {
                es.push([stepKey++, e]);
                continue;
              } else {
                return left2(new Composite2(ast, input, e, output));
              }
            }
          }
          const parser = propertySignatures[i][0];
          const te = parser(input[name], options);
          if (isEither4(te)) {
            if (isLeft2(te)) {
              const e = new Pointer(name, input, hasKey ? te.left : new Missing(ps));
              if (allErrors) {
                es.push([stepKey++, e]);
                continue;
              } else {
                return left2(new Composite2(ast, input, e, output));
              }
            }
            output[name] = te.right;
          } else {
            const nk = stepKey++;
            const index = name;
            if (!queue) {
              queue = [];
            }
            queue.push(({
              es: es2,
              output: output2
            }) => flatMap10(either3(te), (t) => {
              if (isLeft2(t)) {
                const e = new Pointer(index, input, hasKey ? t.left : new Missing(ps));
                if (allErrors) {
                  es2.push([nk, e]);
                  return _void;
                } else {
                  return left2(new Composite2(ast, input, e, output2));
                }
              }
              output2[index] = t.right;
              return _void;
            }));
          }
        }
        for (let i = 0;i < indexSignatures.length; i++) {
          const indexSignature = indexSignatures[i];
          const parameter = indexSignature[0];
          const type2 = indexSignature[1];
          const keys7 = getKeysForIndexSignature(input, indexSignature[2]);
          for (const key of keys7) {
            const keu = parameter(key, options);
            if (isEither4(keu) && isRight2(keu)) {
              const vpr = type2(input[key], options);
              if (isEither4(vpr)) {
                if (isLeft2(vpr)) {
                  const e = new Pointer(key, input, vpr.left);
                  if (allErrors) {
                    es.push([stepKey++, e]);
                    continue;
                  } else {
                    return left2(new Composite2(ast, input, e, output));
                  }
                } else {
                  if (!Object.prototype.hasOwnProperty.call(expectedKeysMap, key)) {
                    output[key] = vpr.right;
                  }
                }
              } else {
                const nk = stepKey++;
                const index = key;
                if (!queue) {
                  queue = [];
                }
                queue.push(({
                  es: es2,
                  output: output2
                }) => flatMap10(either3(vpr), (tv) => {
                  if (isLeft2(tv)) {
                    const e = new Pointer(index, input, tv.left);
                    if (allErrors) {
                      es2.push([nk, e]);
                      return _void;
                    } else {
                      return left2(new Composite2(ast, input, e, output2));
                    }
                  } else {
                    if (!Object.prototype.hasOwnProperty.call(expectedKeysMap, key)) {
                      output2[key] = tv.right;
                    }
                    return _void;
                  }
                }));
              }
            }
          }
        }
        const computeResult = ({
          es: es2,
          output: output2
        }) => {
          if (isNonEmptyArray2(es2)) {
            return left2(new Composite2(ast, input, sortByIndex(es2), output2));
          }
          if (options?.propertyOrder === "original") {
            const keys7 = inputKeys || ownKeys(input);
            for (const name of expectedKeys) {
              if (keys7.indexOf(name) === -1) {
                keys7.push(name);
              }
            }
            const out = {};
            for (const key of keys7) {
              if (Object.prototype.hasOwnProperty.call(output2, key)) {
                out[key] = output2[key];
              }
            }
            return right2(out);
          }
          return right2(output2);
        };
        if (queue && queue.length > 0) {
          const cqueue = queue;
          return suspend3(() => {
            const state = {
              es: copy(es),
              output: Object.assign({}, output)
            };
            return flatMap10(forEach8(cqueue, (f) => f(state), {
              concurrency,
              batching,
              discard: true
            }), () => computeResult(state));
          });
        }
        return computeResult({
          es,
          output
        });
      };
    }
    case "Union": {
      const searchTree = getSearchTree(ast.types, isDecoding);
      const ownKeys2 = ownKeys(searchTree.keys);
      const ownKeysLen = ownKeys2.length;
      const astTypesLen = ast.types.length;
      const map26 = new Map;
      for (let i = 0;i < astTypesLen; i++) {
        map26.set(ast.types[i], goMemo(ast.types[i], isDecoding));
      }
      const concurrency = getConcurrency(ast) ?? 1;
      const batching = getBatching(ast);
      return (input, options) => {
        const es = [];
        let stepKey = 0;
        let candidates = [];
        if (ownKeysLen > 0) {
          if (isRecordOrArray(input)) {
            for (let i = 0;i < ownKeysLen; i++) {
              const name = ownKeys2[i];
              const buckets = searchTree.keys[name].buckets;
              if (Object.prototype.hasOwnProperty.call(input, name)) {
                const literal2 = String(input[name]);
                if (Object.prototype.hasOwnProperty.call(buckets, literal2)) {
                  candidates = candidates.concat(buckets[literal2]);
                } else {
                  const {
                    candidates: candidates2,
                    literals
                  } = searchTree.keys[name];
                  const literalsUnion = Union.make(literals);
                  const errorAst = candidates2.length === astTypesLen ? new TypeLiteral([new PropertySignature(name, literalsUnion, false, true)], []) : Union.make(candidates2);
                  es.push([stepKey++, new Composite2(errorAst, input, new Pointer(name, input, new Type2(literalsUnion, input[name])))]);
                }
              } else {
                const {
                  candidates: candidates2,
                  literals
                } = searchTree.keys[name];
                const fakePropertySignature = new PropertySignature(name, Union.make(literals), false, true);
                const errorAst = candidates2.length === astTypesLen ? new TypeLiteral([fakePropertySignature], []) : Union.make(candidates2);
                es.push([stepKey++, new Composite2(errorAst, input, new Pointer(name, input, new Missing(fakePropertySignature)))]);
              }
            }
          } else {
            const errorAst = searchTree.candidates.length === astTypesLen ? ast : Union.make(searchTree.candidates);
            es.push([stepKey++, new Type2(errorAst, input)]);
          }
        }
        if (searchTree.otherwise.length > 0) {
          candidates = candidates.concat(searchTree.otherwise);
        }
        let queue = undefined;
        for (let i = 0;i < candidates.length; i++) {
          const candidate = candidates[i];
          const pr = map26.get(candidate)(input, options);
          if (isEither4(pr) && (!queue || queue.length === 0)) {
            if (isRight2(pr)) {
              return pr;
            } else {
              es.push([stepKey++, pr.left]);
            }
          } else {
            const nk = stepKey++;
            if (!queue) {
              queue = [];
            }
            queue.push((state) => suspend3(() => {
              if ("finalResult" in state) {
                return _void;
              } else {
                return flatMap10(either3(pr), (t) => {
                  if (isRight2(t)) {
                    state.finalResult = t;
                  } else {
                    state.es.push([nk, t.left]);
                  }
                  return _void;
                });
              }
            }));
          }
        }
        const computeResult = (es2) => isNonEmptyArray2(es2) ? es2.length === 1 && es2[0][1]._tag === "Type" ? left2(es2[0][1]) : left2(new Composite2(ast, input, sortByIndex(es2))) : left2(new Type2(ast, input));
        if (queue && queue.length > 0) {
          const cqueue = queue;
          return suspend3(() => {
            const state = {
              es: copy(es)
            };
            return flatMap10(forEach8(cqueue, (f) => f(state), {
              concurrency,
              batching,
              discard: true
            }), () => {
              if ("finalResult" in state) {
                return state.finalResult;
              }
              return computeResult(state.es);
            });
          });
        }
        return computeResult(es);
      };
    }
    case "Suspend": {
      const get21 = memoizeThunk(() => goMemo(annotations(ast.f(), ast.annotations), isDecoding));
      return (a, options) => get21()(a, options);
    }
  }
}, fromRefinement = (ast, refinement) => (u) => refinement(u) ? right2(u) : left2(new Type2(ast, u)), getLiterals = (ast, isDecoding) => {
  switch (ast._tag) {
    case "Declaration": {
      const annotation = getSurrogateAnnotation(ast);
      if (isSome2(annotation)) {
        return getLiterals(annotation.value, isDecoding);
      }
      break;
    }
    case "TypeLiteral": {
      const out = [];
      for (let i = 0;i < ast.propertySignatures.length; i++) {
        const propertySignature = ast.propertySignatures[i];
        const type2 = isDecoding ? encodedAST(propertySignature.type) : typeAST(propertySignature.type);
        if (isLiteral(type2) && !propertySignature.isOptional) {
          out.push([propertySignature.name, type2]);
        }
      }
      return out;
    }
    case "TupleType": {
      const out = [];
      for (let i = 0;i < ast.elements.length; i++) {
        const element = ast.elements[i];
        const type2 = isDecoding ? encodedAST(element.type) : typeAST(element.type);
        if (isLiteral(type2) && !element.isOptional) {
          out.push([i, type2]);
        }
      }
      return out;
    }
    case "Refinement":
      return getLiterals(ast.from, isDecoding);
    case "Suspend":
      return getLiterals(ast.f(), isDecoding);
    case "Transformation":
      return getLiterals(isDecoding ? ast.from : ast.to, isDecoding);
  }
  return [];
}, getSearchTree = (members, isDecoding) => {
  const keys7 = {};
  const otherwise = [];
  const candidates = [];
  for (let i = 0;i < members.length; i++) {
    const member = members[i];
    const tags2 = getLiterals(member, isDecoding);
    if (tags2.length > 0) {
      candidates.push(member);
      for (let j = 0;j < tags2.length; j++) {
        const [key, literal2] = tags2[j];
        const hash2 = String(literal2.literal);
        keys7[key] = keys7[key] || {
          buckets: {},
          literals: [],
          candidates: []
        };
        const buckets = keys7[key].buckets;
        if (Object.prototype.hasOwnProperty.call(buckets, hash2)) {
          if (j < tags2.length - 1) {
            continue;
          }
          buckets[hash2].push(member);
          keys7[key].literals.push(literal2);
          keys7[key].candidates.push(member);
        } else {
          buckets[hash2] = [member];
          keys7[key].literals.push(literal2);
          keys7[key].candidates.push(member);
          break;
        }
      }
    } else {
      otherwise.push(member);
    }
  }
  return {
    keys: keys7,
    otherwise,
    candidates
  };
}, dropRightRefinement = (ast) => isRefinement(ast) ? dropRightRefinement(ast.from) : ast, handleForbidden = (effect4, ast, actual, options) => {
  if (options?.isEffectAllowed === true) {
    return effect4;
  }
  if (isEither4(effect4)) {
    return effect4;
  }
  const scheduler = new SyncScheduler;
  const fiber = runFork2(effect4, {
    scheduler
  });
  scheduler.flush();
  const exit3 = fiber.unsafePoll();
  if (exit3) {
    if (isSuccess(exit3)) {
      return right2(exit3.value);
    }
    const cause3 = exit3.cause;
    if (isFailType2(cause3)) {
      return left2(cause3.error);
    }
    return left2(new Forbidden(ast, actual, pretty2(cause3)));
  }
  return left2(new Forbidden(ast, actual, "cannot be be resolved synchronously, this is caused by using runSync on an effect that performs async work"));
}, compare = ([a], [b]) => a > b ? 1 : a < b ? -1 : 0, getFinalTransformation = (transformation, isDecoding) => {
  switch (transformation._tag) {
    case "FinalTransformation":
      return isDecoding ? transformation.decode : transformation.encode;
    case "ComposeTransformation":
      return right2;
    case "TypeLiteralTransformation":
      return (input) => {
        let out = right2(input);
        for (const pst of transformation.propertySignatureTransformations) {
          const [from, to] = isDecoding ? [pst.from, pst.to] : [pst.to, pst.from];
          const transformation2 = isDecoding ? pst.decode : pst.encode;
          const f = (input2) => {
            const o = transformation2(Object.prototype.hasOwnProperty.call(input2, from) ? some2(input2[from]) : none2());
            delete input2[from];
            if (isSome2(o)) {
              input2[to] = o.value;
            }
            return input2;
          };
          out = map25(out, f);
        }
        return out;
      };
  }
}, makeTree = (value3, forest = []) => ({
  value: value3,
  forest
}), TreeFormatter, drawTree = (tree) => tree.value + draw(`
`, tree.forest), draw = (indentation, forest) => {
  let r = "";
  const len = forest.length;
  let tree;
  for (let i = 0;i < len; i++) {
    tree = forest[i];
    const isLast = i === len - 1;
    r += indentation + (isLast ? "└" : "├") + "─ " + tree.value;
    r += draw(indentation + (len > 1 && !isLast ? "│  " : "   "), tree.forest);
  }
  return r;
}, formatTransformationKind = (kind) => {
  switch (kind) {
    case "Encoded":
      return "Encoded side transformation failure";
    case "Transformation":
      return "Transformation process failure";
    case "Type":
      return "Type side transformation failure";
  }
}, formatRefinementKind = (kind) => {
  switch (kind) {
    case "From":
      return "From side refinement failure";
    case "Predicate":
      return "Predicate refinement failure";
  }
}, getAnnotated = (issue) => ("ast" in issue) ? some2(issue.ast) : none2(), Either_void, getCurrentMessage = (issue) => getAnnotated(issue).pipe(flatMap(getMessageAnnotation), match2({
  onNone: () => Either_void,
  onSome: (messageAnnotation) => {
    const union9 = messageAnnotation(issue);
    if (isString(union9)) {
      return right2({
        message: union9,
        override: false
      });
    }
    if (isEffect2(union9)) {
      return map13(union9, (message) => ({
        message,
        override: false
      }));
    }
    if (isString(union9.message)) {
      return right2({
        message: union9.message,
        override: union9.override
      });
    }
    return map13(union9.message, (message) => ({
      message,
      override: union9.override
    }));
  }
})), createParseIssueGuard = (tag2) => (issue) => issue._tag === tag2, isComposite2, isRefinement2, isTransformation2, getMessage = (issue) => flatMap16(getCurrentMessage(issue), (currentMessage) => {
  if (currentMessage !== undefined) {
    const useInnerMessage = !currentMessage.override && (isComposite2(issue) || isRefinement2(issue) && issue.kind === "From" || isTransformation2(issue) && issue.kind !== "Transformation");
    return useInnerMessage ? isTransformation2(issue) || isRefinement2(issue) ? getMessage(issue.issue) : Either_void : right2(currentMessage.message);
  }
  return Either_void;
}), getParseIssueTitleAnnotation2 = (issue) => getAnnotated(issue).pipe(flatMap(getParseIssueTitleAnnotation), flatMapNullable((annotation) => annotation(issue)), getOrUndefined), formatTypeMessage = (issue) => map25(getMessage(issue), (message) => message ?? getParseIssueTitleAnnotation2(issue) ?? getDefaultTypeMessage(issue)), getParseIssueTitle = (issue) => getParseIssueTitleAnnotation2(issue) ?? String(issue.ast), formatForbiddenMessage = (issue) => issue.message ?? "is forbidden", formatUnexpectedMessage = (issue) => issue.message ?? "is unexpected", formatMissingMessage = (issue) => {
  const missingMessageAnnotation = getMissingMessageAnnotation(issue.ast);
  if (isSome2(missingMessageAnnotation)) {
    const annotation = missingMessageAnnotation.value();
    return isString(annotation) ? right2(annotation) : annotation;
  }
  return right2(issue.message ?? "is missing");
}, formatTree = (issue) => {
  switch (issue._tag) {
    case "Type":
      return map25(formatTypeMessage(issue), makeTree);
    case "Forbidden":
      return right2(makeTree(getParseIssueTitle(issue), [makeTree(formatForbiddenMessage(issue))]));
    case "Unexpected":
      return right2(makeTree(formatUnexpectedMessage(issue)));
    case "Missing":
      return map25(formatMissingMessage(issue), makeTree);
    case "Transformation":
      return flatMap16(getMessage(issue), (message) => {
        if (message !== undefined) {
          return right2(makeTree(message));
        }
        return map25(formatTree(issue.issue), (tree) => makeTree(getParseIssueTitle(issue), [makeTree(formatTransformationKind(issue.kind), [tree])]));
      });
    case "Refinement":
      return flatMap16(getMessage(issue), (message) => {
        if (message !== undefined) {
          return right2(makeTree(message));
        }
        return map25(formatTree(issue.issue), (tree) => makeTree(getParseIssueTitle(issue), [makeTree(formatRefinementKind(issue.kind), [tree])]));
      });
    case "Pointer":
      return map25(formatTree(issue.issue), (tree) => makeTree(formatPath(issue.path), [tree]));
    case "Composite":
      return flatMap16(getMessage(issue), (message) => {
        if (message !== undefined) {
          return right2(makeTree(message));
        }
        const parseIssueTitle = getParseIssueTitle(issue);
        return isNonEmpty(issue.issues) ? map25(forEach8(issue.issues, formatTree), (forest) => makeTree(parseIssueTitle, forest)) : map25(formatTree(issue.issues), (tree) => makeTree(parseIssueTitle, [tree]));
      });
  }
};
var init_ParseResult = __esm(() => {
  init_Array();
  init_Cause();
  init_Data();
  init_Effect();
  init_Either();
  init_Exit();
  init_Function();
  init_GlobalValue();
  init_Inspectable();
  init_util();
  init_Option();
  init_Predicate();
  init_Scheduler();
  init_SchemaAST();
  ParseErrorTypeId = /* @__PURE__ */ Symbol.for("effect/Schema/ParseErrorTypeId");
  ParseError = class ParseError extends (/* @__PURE__ */ TaggedError("ParseError")) {
    [ParseErrorTypeId] = ParseErrorTypeId;
    get message() {
      return this.toString();
    }
    toString() {
      return TreeFormatter.formatIssueSync(this.issue);
    }
    toJSON() {
      return {
        _id: "ParseError",
        message: this.toString()
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  succeed17 = right2;
  fail16 = left2;
  isEither4 = isEither2;
  flatMap16 = /* @__PURE__ */ dual(2, (self, f) => {
    return isEither4(self) ? match(self, {
      onLeft: left2,
      onRight: f
    }) : flatMap10(self, f);
  });
  map25 = /* @__PURE__ */ dual(2, (self, f) => {
    return isEither4(self) ? map(self, f) : map13(self, f);
  });
  mapError6 = /* @__PURE__ */ dual(2, (self, f) => {
    return isEither4(self) ? mapLeft(self, f) : mapError3(self, f);
  });
  orElse11 = /* @__PURE__ */ dual(2, (self, f) => {
    return isEither4(self) ? match(self, {
      onLeft: f,
      onRight: right2
    }) : catchAll3(self, f);
  });
  decodeMemoMap = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/ParseResult/decodeMemoMap"), () => new WeakMap);
  encodeMemoMap = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/ParseResult/encodeMemoMap"), () => new WeakMap);
  TreeFormatter = {
    formatIssue: (issue) => map25(formatTree(issue), drawTree),
    formatIssueSync: (issue) => {
      const e = TreeFormatter.formatIssue(issue);
      return isEither4(e) ? getOrThrow(e) : runSync(e);
    },
    formatError: (error2) => TreeFormatter.formatIssue(error2.issue),
    formatErrorSync: (error2) => TreeFormatter.formatIssueSync(error2.issue)
  };
  Either_void = /* @__PURE__ */ right2(undefined);
  isComposite2 = /* @__PURE__ */ createParseIssueGuard("Composite");
  isRefinement2 = /* @__PURE__ */ createParseIssueGuard("Refinement");
  isTransformation2 = /* @__PURE__ */ createParseIssueGuard("Transformation");
});

// node_modules/effect/dist/esm/Pool.js
var init_Pool = __esm(() => {
  init_pool();
});

// node_modules/effect/dist/esm/Pretty.js
var init_Pretty = __esm(() => {
  init_Array();
  init_errors();
  init_util();
  init_Option();
  init_ParseResult();
  init_SchemaAST();
});

// node_modules/effect/dist/esm/PrimaryKey.js
var init_PrimaryKey = () => {};

// node_modules/effect/dist/esm/internal/rateLimiter.js
var init_rateLimiter = __esm(() => {
  init_Duration();
  init_Effect();
  init_FiberRef();
  init_Function();
  init_GlobalValue();
});

// node_modules/effect/dist/esm/RateLimiter.js
var init_RateLimiter = __esm(() => {
  init_rateLimiter();
});

// node_modules/effect/dist/esm/Redacted.js
var init_Redacted = __esm(() => {
  init_Equivalence();
  init_redacted();
});

// node_modules/effect/dist/esm/internal/scopedRef.js
var ScopedRefSymbolKey = "effect/ScopedRef", ScopedRefTypeId, scopedRefVariance, proto14, get21 = (self) => map9(get11(self.ref), (tuple3) => tuple3[1]);
var init_scopedRef = __esm(() => {
  init_Context();
  init_Function();
  init_core();
  init_circular();
  init_effectable();
  init_fiberRuntime();
  init_ref();
  init_synchronizedRef();
  ScopedRefTypeId = /* @__PURE__ */ Symbol.for(ScopedRefSymbolKey);
  scopedRefVariance = {
    _A: (_) => _
  };
  proto14 = {
    ...CommitPrototype,
    commit() {
      return get21(this);
    },
    [ScopedRefTypeId]: scopedRefVariance
  };
});

// node_modules/effect/dist/esm/internal/reloadable.js
var init_reloadable = __esm(() => {
  init_Context();
  init_Function();
  init_core_effect();
  init_core();
  init_fiberRuntime();
  init_layer();
  init_schedule();
  init_scopedRef();
});

// node_modules/effect/dist/esm/Reloadable.js
var init_Reloadable = __esm(() => {
  init_reloadable();
});

// node_modules/effect/dist/esm/RequestBlock.js
var init_RequestBlock = __esm(() => {
  init_blockedRequests();
});

// node_modules/effect/dist/esm/internal/dataSource.js
var init_dataSource = __esm(() => {
  init_Array();
  init_Cause();
  init_Chunk();
  init_Effect();
  init_Function();
  init_core();
  init_fiberRuntime();
  init_request();
});

// node_modules/effect/dist/esm/RequestResolver.js
var init_RequestResolver = __esm(() => {
  init_Context();
  init_Effect();
  init_core();
  init_dataSource();
});

// node_modules/effect/dist/esm/internal/resource.js
var ResourceSymbolKey = "effect/Resource", ResourceTypeId, resourceVariance, proto15, get23 = (self) => flatMap7(get21(self.scopedRef), identity);
var init_resource = __esm(() => {
  init_Function();
  init_core();
  init_effectable();
  init_fiberRuntime();
  init_schedule();
  init_scopedRef();
  ResourceTypeId = /* @__PURE__ */ Symbol.for(ResourceSymbolKey);
  resourceVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
  proto15 = {
    ...CommitPrototype,
    commit() {
      return get23(this);
    },
    [ResourceTypeId]: resourceVariance
  };
});

// node_modules/effect/dist/esm/Resource.js
var init_Resource = __esm(() => {
  init_resource();
});

// node_modules/effect/dist/esm/RuntimeFlags.js
var init_RuntimeFlags = __esm(() => {
  init_circular3();
  init_runtimeFlags();
});

// node_modules/effect/dist/esm/STM.js
var init_STM = __esm(() => {
  init_Cause();
  init_Chunk();
  init_core2();
  init_stm();
});

// node_modules/effect/dist/esm/Struct.js
var init_Struct = __esm(() => {
  init_Equivalence();
  init_Function();
  init_Order();
  init_Predicate();
});

// node_modules/effect/dist/esm/Schema.js
function make68(ast) {
  return class SchemaClass {
    [TypeId27] = variance9;
    static ast = ast;
    static annotations(annotations2) {
      return make68(mergeSchemaAnnotations(this.ast, annotations2));
    }
    static pipe() {
      return pipeArguments(this, arguments);
    }
    static toString() {
      return String(ast);
    }
    static Type;
    static Encoded;
    static Context;
    static [TypeId27] = variance9;
  };
}
function makeDeclareClass(typeParameters, ast) {
  return class DeclareClass extends make68(ast) {
    static annotations(annotations2) {
      return makeDeclareClass(this.typeParameters, mergeSchemaAnnotations(this.ast, annotations2));
    }
    static typeParameters = [...typeParameters];
  };
}
function makeRefineClass(from, filter12, ast) {
  return class RefineClass extends make68(ast) {
    static annotations(annotations2) {
      return makeRefineClass(this.from, this.filter, mergeSchemaAnnotations(this.ast, annotations2));
    }
    static [RefineSchemaId] = from;
    static from = from;
    static filter = filter12;
    static make = (a, options) => {
      return getDisableValidationMakeOption(options) ? a : validateSync(this)(a);
    };
  };
}
function filter12(predicate, annotations2) {
  return (self) => {
    function filter13(input, options, ast2) {
      return toFilterParseIssue(predicate(input, options, ast2), ast2, input);
    }
    const ast = new Refinement(self.ast, filter13, toASTAnnotations(annotations2));
    return makeRefineClass(self, filter13, ast);
  };
}
function getDisableValidationMakeOption(options) {
  return isBoolean(options) ? options : options?.disableValidation ?? false;
}
var TypeId27, variance9, builtInAnnotations, toASTAnnotations = (annotations2) => {
  if (!annotations2) {
    return {};
  }
  const out = {
    ...annotations2
  };
  for (const key in builtInAnnotations) {
    if (key in annotations2) {
      const id2 = builtInAnnotations[key];
      out[id2] = annotations2[key];
      delete out[key];
    }
  }
  return out;
}, mergeSchemaAnnotations = (ast, annotations2) => annotations(ast, toASTAnnotations(annotations2)), declareConstructor = (typeParameters, options, annotations2) => makeDeclareClass(typeParameters, new Declaration(typeParameters.map((tp) => tp.ast), (...typeParameters2) => options.decode(...typeParameters2.map(make68)), (...typeParameters2) => options.encode(...typeParameters2.map(make68)), toASTAnnotations(annotations2))), declarePrimitive = (is3, annotations2) => {
  const decodeUnknown3 = () => (input, _, ast) => is3(input) ? succeed17(input) : fail16(new Type2(ast, input));
  const encodeUnknown2 = decodeUnknown3;
  return makeDeclareClass([], new Declaration([], decodeUnknown3, encodeUnknown2, toASTAnnotations(annotations2)));
}, declare = function() {
  if (Array.isArray(arguments[0])) {
    const typeParameters = arguments[0];
    const options = arguments[1];
    const annotations3 = arguments[2];
    return declareConstructor(typeParameters, options, annotations3);
  }
  const is3 = arguments[0];
  const annotations2 = arguments[1];
  return declarePrimitive(is3, annotations2);
}, String$, RefineSchemaId, fromFilterPredicateReturnTypeItem = (item, ast, input) => {
  if (isBoolean(item)) {
    return item ? none2() : some2(new Type2(ast, input));
  }
  if (isString(item)) {
    return some2(new Type2(ast, input, item));
  }
  if (item !== undefined) {
    if ("_tag" in item) {
      return some2(item);
    }
    const issue = new Type2(ast, input, item.message);
    return some2(isNonEmptyReadonlyArray(item.path) ? new Pointer(item.path, input, issue) : issue);
  }
  return none2();
}, toFilterParseIssue = (out, ast, input) => {
  if (isSingle(out)) {
    return fromFilterPredicateReturnTypeItem(out, ast, input);
  }
  if (isNonEmptyReadonlyArray(out)) {
    const issues = filterMap(out, (issue) => fromFilterPredicateReturnTypeItem(issue, ast, input));
    if (isNonEmptyReadonlyArray(issues)) {
      return some2(issues.length === 1 ? issues[0] : new Composite2(ast, input, issues));
    }
  }
  return none2();
}, PatternSchemaId, pattern = (regex, annotations2) => (self) => {
  const source = regex.source;
  return self.pipe(filter12((a) => {
    regex.lastIndex = 0;
    return regex.test(a);
  }, {
    schemaId: PatternSchemaId,
    [PatternSchemaId]: {
      regex
    },
    description: `a string matching the pattern ${source}`,
    jsonSchema: {
      pattern: source
    },
    ...annotations2
  }));
}, UUIDSchemaId, uuidRegexp, UUID, DateFromSelfSchemaId2, DateFromSelf;
var init_Schema = __esm(() => {
  init_Array();
  init_BigDecimal();
  init_BigInt();
  init_Boolean();
  init_Cause();
  init_Chunk();
  init_Config();
  init_ConfigError();
  init_Data();
  init_DateTime();
  init_Duration();
  init_Effect();
  init_Either();
  init_Encoding();
  init_Equal();
  init_Equivalence();
  init_Exit();
  init_FastCheck();
  init_FiberId();
  init_Function();
  init_GlobalValue();
  init_HashMap();
  init_HashSet();
  init_cause();
  init_errors();
  init_schemaId();
  init_util();
  init_List();
  init_Number();
  init_Option();
  init_ParseResult();
  init_Predicate();
  init_Redacted();
  init_Request();
  init_Scheduler();
  init_SchemaAST();
  init_SortedSet();
  init_String();
  init_Struct();
  init_ParseResult();
  TypeId27 = /* @__PURE__ */ Symbol.for("effect/Schema");
  variance9 = {
    _A: (_) => _,
    _I: (_) => _,
    _R: (_) => _
  };
  builtInAnnotations = {
    schemaId: SchemaIdAnnotationId,
    message: MessageAnnotationId,
    missingMessage: MissingMessageAnnotationId,
    identifier: IdentifierAnnotationId,
    title: TitleAnnotationId,
    description: DescriptionAnnotationId,
    examples: ExamplesAnnotationId,
    default: DefaultAnnotationId,
    documentation: DocumentationAnnotationId,
    jsonSchema: JSONSchemaAnnotationId,
    arbitrary: ArbitraryAnnotationId,
    pretty: PrettyAnnotationId,
    equivalence: EquivalenceAnnotationId,
    concurrency: ConcurrencyAnnotationId,
    batching: BatchingAnnotationId,
    parseIssueTitle: ParseIssueTitleAnnotationId,
    parseOptions: ParseOptionsAnnotationId,
    decodingFallback: DecodingFallbackAnnotationId
  };
  String$ = class String$ extends (/* @__PURE__ */ make68(stringKeyword)) {
  };
  RefineSchemaId = /* @__PURE__ */ Symbol.for("effect/SchemaId/Refine");
  PatternSchemaId = /* @__PURE__ */ Symbol.for("effect/SchemaId/Pattern");
  UUIDSchemaId = /* @__PURE__ */ Symbol.for("effect/SchemaId/UUID");
  uuidRegexp = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
  UUID = class UUID extends (/* @__PURE__ */ String$.pipe(/* @__PURE__ */ pattern(uuidRegexp, {
    schemaId: UUIDSchemaId,
    identifier: "UUID",
    jsonSchema: {
      format: "uuid",
      pattern: uuidRegexp.source
    },
    description: "a Universally Unique Identifier",
    arbitrary: () => (fc) => fc.uuid()
  }))) {
  };
  DateFromSelfSchemaId2 = DateFromSelfSchemaId;
  DateFromSelf = class DateFromSelf extends (/* @__PURE__ */ declare(isDate, {
    identifier: "DateFromSelf",
    schemaId: DateFromSelfSchemaId2,
    [DateFromSelfSchemaId2]: {
      noInvalidDate: false
    },
    description: "a potentially invalid Date instance",
    pretty: () => (date2) => `new Date(${JSON.stringify(date2)})`,
    arbitrary: () => (fc) => fc.date({
      noInvalidDate: false
    }),
    equivalence: () => Date2
  })) {
  };
});

// node_modules/effect/dist/esm/internal/scopedCache.js
var init_scopedCache = __esm(() => {
  init_Context();
  init_Data();
  init_Duration();
  init_Equal();
  init_Exit();
  init_Function();
  init_HashSet();
  init_MutableHashMap();
  init_MutableQueue();
  init_MutableRef();
  init_Option();
  init_Scope();
  init_cache();
  init_core_effect();
  init_core();
  init_fiberRuntime();
});

// node_modules/effect/dist/esm/ScopedCache.js
var init_ScopedCache = __esm(() => {
  init_scopedCache();
});

// node_modules/effect/dist/esm/ScopedRef.js
var init_ScopedRef = __esm(() => {
  init_scopedRef();
});

// node_modules/effect/dist/esm/Secret.js
var init_Secret = __esm(() => {
  init_secret();
});

// node_modules/effect/dist/esm/SingleProducerAsyncInput.js
var init_SingleProducerAsyncInput = __esm(() => {
  init_singleProducerAsyncInput();
});

// node_modules/effect/dist/esm/Sink.js
var init_Sink = __esm(() => {
  init_sink();
});

// node_modules/effect/dist/esm/SortedMap.js
var TypeId28, SortedMapProto, isSortedMap = (u) => hasProperty(u, TypeId28);
var init_SortedMap = __esm(() => {
  init_Equal();
  init_Function();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Predicate();
  init_RedBlackTree();
  TypeId28 = /* @__PURE__ */ Symbol.for("effect/SortedMap");
  SortedMapProto = {
    [TypeId28]: {
      _K: (_) => _,
      _V: (_) => _
    },
    [symbol]() {
      return pipe(hash(this.tree), combine(hash("effect/SortedMap")), cached(this));
    },
    [symbol2](that) {
      return isSortedMap(that) && equals(this.tree, that.tree);
    },
    [Symbol.iterator]() {
      return this.tree[Symbol.iterator]();
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "SortedMap",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/Stream.js
var init_Stream = __esm(() => {
  init_groupBy();
  init_stream();
});

// node_modules/effect/dist/esm/StreamEmit.js
var init_StreamEmit = () => {};

// node_modules/effect/dist/esm/Streamable.js
var init_Streamable = __esm(() => {
  init_Stream();
});

// node_modules/effect/dist/esm/Subscribable.js
var TypeId29, Proto6;
var init_Subscribable = __esm(() => {
  init_Effect();
  init_Function();
  init_Predicate();
  init_Readable();
  init_Stream();
  TypeId29 = /* @__PURE__ */ Symbol.for("effect/Subscribable");
  Proto6 = {
    [TypeId13]: TypeId13,
    [TypeId29]: TypeId29,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/SynchronizedRef.js
var init_SynchronizedRef = __esm(() => {
  init_circular();
  init_ref();
  init_synchronizedRef();
});

// node_modules/effect/dist/esm/internal/subscriptionRef.js
var init_subscriptionRef = __esm(() => {
  init_Effect();
  init_Effectable();
  init_Function();
  init_PubSub();
  init_Readable();
  init_Ref();
  init_Subscribable();
  init_SynchronizedRef();
  init_circular();
  init_ref();
  init_stream();
});

// node_modules/effect/dist/esm/SubscriptionRef.js
var init_SubscriptionRef = __esm(() => {
  init_subscriptionRef();
  init_Ref();
  init_SynchronizedRef();
});

// node_modules/effect/dist/esm/Supervisor.js
var init_Supervisor = __esm(() => {
  init_core();
  init_circular3();
  init_supervisor();
});

// node_modules/effect/dist/esm/Symbol.js
var init_Symbol = __esm(() => {
  init_Equivalence();
  init_Predicate();
});

// node_modules/effect/dist/esm/internal/stm/tArray.js
var init_tArray = __esm(() => {
  init_Equal();
  init_Function();
  init_Option();
  init_Order();
  init_core2();
  init_stm();
  init_tRef();
});

// node_modules/effect/dist/esm/TArray.js
var init_TArray = __esm(() => {
  init_tArray();
});

// node_modules/effect/dist/esm/internal/stm/tDeferred.js
var init_tDeferred = __esm(() => {
  init_Either();
  init_Function();
  init_Option();
  init_core2();
  init_stm();
  init_tRef();
});

// node_modules/effect/dist/esm/TDeferred.js
var init_TDeferred = __esm(() => {
  init_tDeferred();
});

// node_modules/effect/dist/esm/internal/stm/tMap.js
var init_tMap = __esm(() => {
  init_Array();
  init_Chunk();
  init_Equal();
  init_Function();
  init_Hash();
  init_HashMap();
  init_Option();
  init_Predicate();
  init_STM();
  init_core2();
  init_stm();
  init_tArray();
  init_tRef();
});

// node_modules/effect/dist/esm/TMap.js
var init_TMap = __esm(() => {
  init_tMap();
});

// node_modules/effect/dist/esm/internal/stm/tPriorityQueue.js
var init_tPriorityQueue = __esm(() => {
  init_Array();
  init_Chunk();
  init_Function();
  init_Option();
  init_SortedMap();
  init_core2();
  init_tRef();
});

// node_modules/effect/dist/esm/TPriorityQueue.js
var init_TPriorityQueue = __esm(() => {
  init_tPriorityQueue();
});

// node_modules/effect/dist/esm/internal/stm/tRandom.js
var init_tRandom = __esm(() => {
  init_Context();
  init_Function();
  init_Layer();
  init_Utils();
  init_core2();
  init_stm();
  init_tArray();
  init_tRef();
});

// node_modules/effect/dist/esm/TRandom.js
var init_TRandom = __esm(() => {
  init_tRandom();
});

// node_modules/effect/dist/esm/internal/stm/tReentrantLock.js
var init_tReentrantLock = __esm(() => {
  init_Effect();
  init_Equal();
  init_FiberId();
  init_Function();
  init_HashMap();
  init_Option();
  init_core2();
  init_tRef();
});

// node_modules/effect/dist/esm/TReentrantLock.js
var init_TReentrantLock = __esm(() => {
  init_tReentrantLock();
});

// node_modules/effect/dist/esm/TRef.js
var init_TRef = __esm(() => {
  init_tRef();
});

// node_modules/effect/dist/esm/internal/stm/tSemaphore.js
var init_tSemaphore = __esm(() => {
  init_Cause();
  init_Effect();
  init_Function();
  init_STM();
  init_core2();
  init_tRef();
});

// node_modules/effect/dist/esm/TSemaphore.js
var init_TSemaphore = __esm(() => {
  init_tSemaphore();
});

// node_modules/effect/dist/esm/internal/stm/tSet.js
var init_tSet = __esm(() => {
  init_Array();
  init_Chunk();
  init_Function();
  init_HashSet();
  init_Predicate();
  init_STM();
  init_core2();
  init_tMap();
});

// node_modules/effect/dist/esm/TSet.js
var init_TSet = __esm(() => {
  init_tSet();
});

// node_modules/effect/dist/esm/internal/stm/tSubscriptionRef.js
var init_tSubscriptionRef = __esm(() => {
  init_Effect();
  init_Function();
  init_Option();
  init_STM();
  init_TPubSub();
  init_TQueue();
  init_TRef();
  init_stream();
  init_tQueue();
  init_tRef();
});

// node_modules/effect/dist/esm/TSubscriptionRef.js
var init_TSubscriptionRef = __esm(() => {
  init_tSubscriptionRef();
});

// node_modules/effect/dist/esm/Take.js
var init_Take = __esm(() => {
  init_take();
});

// node_modules/effect/dist/esm/TestAnnotation.js
var init_TestAnnotation = __esm(() => {
  init_Chunk();
  init_Either();
  init_Equal();
  init_Function();
  init_Hash();
  init_HashSet();
  init_Predicate();
});

// node_modules/effect/dist/esm/TestAnnotationMap.js
var init_TestAnnotationMap = __esm(() => {
  init_Function();
  init_HashMap();
  init_Predicate();
});

// node_modules/effect/dist/esm/TestAnnotations.js
var init_TestAnnotations = __esm(() => {
  init_Array();
  init_Context();
  init_Equal();
  init_Function();
  init_core_effect();
  init_core();
  init_fiber();
  init_MutableRef();
  init_Predicate();
  init_Ref();
  init_SortedSet();
  init_TestAnnotation();
  init_TestAnnotationMap();
});

// node_modules/effect/dist/esm/internal/testing/suspendedWarningData.js
var init_suspendedWarningData = () => {};

// node_modules/effect/dist/esm/internal/testing/warningData.js
var init_warningData = () => {};

// node_modules/effect/dist/esm/TestLive.js
var init_TestLive = __esm(() => {
  init_Context();
  init_core();
  init_defaultServices();
});

// node_modules/effect/dist/esm/TestClock.js
var warning, suspendedWarning;
var init_TestClock = __esm(() => {
  init_Chunk();
  init_Context();
  init_DateTime();
  init_Duration();
  init_Equal();
  init_FiberStatus();
  init_Function();
  init_HashMap();
  init_clock();
  init_core_effect();
  init_core();
  init_defaultServices();
  init_circular();
  init_fiberRuntime();
  init_layer();
  init_ref();
  init_synchronizedRef();
  init_suspendedWarningData();
  init_warningData();
  init_Number();
  init_Option();
  init_Order();
  init_TestAnnotations();
  init_TestLive();
  warning = "Warning: A test is using time, but is not advancing " + "the test clock, which may result in the test hanging. Use TestClock.adjust to " + "manually advance the time.";
  suspendedWarning = "Warning: A test is advancing the test clock, " + "but a fiber is not suspending, which may result in the test hanging. Use " + "TestAspect.diagnose to identity the fiber that is not suspending.";
});

// node_modules/effect/dist/esm/TestConfig.js
var init_TestConfig = __esm(() => {
  init_Context();
});

// node_modules/effect/dist/esm/TestSized.js
var init_TestSized = __esm(() => {
  init_Context();
  init_core();
});

// node_modules/effect/dist/esm/TestServices.js
var init_TestServices = __esm(() => {
  init_Context();
  init_Effect();
  init_Function();
  init_core();
  init_defaultServices();
  init_fiberRuntime();
  init_layer();
  init_ref();
  init_TestAnnotationMap();
  init_TestAnnotations();
  init_TestConfig();
  init_TestLive();
  init_TestSized();
});

// node_modules/effect/dist/esm/TestContext.js
var init_TestContext = __esm(() => {
  init_Function();
  init_defaultServices();
  init_layer();
  init_TestClock();
  init_TestServices();
});

// node_modules/effect/dist/esm/internal/trie.js
var TrieSymbolKey = "effect/Trie", TrieTypeId, trieVariance, TrieProto, TrieIterator, isTrie = (u) => hasProperty(u, TrieTypeId);
var init_trie = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Predicate();
  TrieTypeId = /* @__PURE__ */ Symbol.for(TrieSymbolKey);
  trieVariance = {
    _Value: (_) => _
  };
  TrieProto = {
    [TrieTypeId]: trieVariance,
    [Symbol.iterator]() {
      return new TrieIterator(this, (k, v) => [k, v], () => true);
    },
    [symbol]() {
      let hash2 = hash(TrieSymbolKey);
      for (const item of this) {
        hash2 ^= pipe(hash(item[0]), combine(hash(item[1])));
      }
      return cached(this, hash2);
    },
    [symbol2](that) {
      if (isTrie(that)) {
        const entries2 = Array.from(that);
        return Array.from(this).every((itemSelf, i) => {
          const itemThat = entries2[i];
          return equals(itemSelf[0], itemThat[0]) && equals(itemSelf[1], itemThat[1]);
        });
      }
      return false;
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Trie",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  TrieIterator = class TrieIterator {
    trie;
    f;
    filter;
    stack = [];
    constructor(trie, f, filter15) {
      this.trie = trie;
      this.f = f;
      this.filter = filter15;
      const root = trie._root !== undefined ? trie._root : undefined;
      if (root !== undefined) {
        this.stack.push([root, "", false]);
      }
    }
    next() {
      while (this.stack.length > 0) {
        const [node, keyString, isAdded] = this.stack.pop();
        if (isAdded) {
          const value6 = node.value;
          if (value6 !== undefined) {
            const key = keyString + node.key;
            if (this.filter(key, value6)) {
              return {
                done: false,
                value: this.f(key, value6)
              };
            }
          }
        } else {
          this.addToStack(node, keyString);
        }
      }
      return {
        done: true,
        value: undefined
      };
    }
    addToStack(node, keyString) {
      if (node.right !== undefined) {
        this.stack.push([node.right, keyString, false]);
      }
      if (node.mid !== undefined) {
        this.stack.push([node.mid, keyString + node.key, false]);
      }
      this.stack.push([node, keyString, true]);
      if (node.left !== undefined) {
        this.stack.push([node.left, keyString, false]);
      }
    }
    [Symbol.iterator]() {
      return new TrieIterator(this.trie, this.f, this.filter);
    }
  };
});

// node_modules/effect/dist/esm/Trie.js
var init_Trie = __esm(() => {
  init_trie();
});

// node_modules/effect/dist/esm/Types.js
var init_Types = () => {};

// node_modules/effect/dist/esm/Unify.js
var init_Unify = __esm(() => {
  init_Function();
});

// node_modules/effect/dist/esm/UpstreamPullRequest.js
var init_UpstreamPullRequest = __esm(() => {
  init_upstreamPullRequest();
});

// node_modules/effect/dist/esm/UpstreamPullStrategy.js
var init_UpstreamPullStrategy = __esm(() => {
  init_upstreamPullStrategy();
});

// node_modules/effect/dist/esm/index.js
var init_esm = __esm(() => {
  init_Function();
  init_Arbitrary();
  init_Array();
  init_BigDecimal();
  init_BigInt();
  init_Boolean();
  init_Brand();
  init_Cache();
  init_Cause();
  init_Channel();
  init_ChildExecutorDecision();
  init_Chunk();
  init_Clock();
  init_Config();
  init_ConfigError();
  init_ConfigProvider();
  init_ConfigProviderPathPatch();
  init_Console();
  init_Context();
  init_Cron();
  init_Data();
  init_DateTime();
  init_DefaultServices();
  init_Deferred();
  init_Differ();
  init_Duration();
  init_Effect();
  init_Effectable();
  init_Either();
  init_Encoding();
  init_Equal();
  init_Equivalence();
  init_ExecutionStrategy();
  init_Exit();
  init_FastCheck();
  init_Fiber();
  init_FiberHandle();
  init_FiberId();
  init_FiberMap();
  init_FiberRef();
  init_FiberRefs();
  init_FiberRefsPatch();
  init_FiberSet();
  init_FiberStatus();
  init_Function();
  init_GlobalValue();
  init_GroupBy();
  init_HKT();
  init_Hash();
  init_HashMap();
  init_HashSet();
  init_Inspectable();
  init_Iterable();
  init_JSONSchema();
  init_KeyedPool();
  init_Layer();
  init_LayerMap();
  init_List();
  init_LogLevel();
  init_LogSpan();
  init_Logger();
  init_Mailbox();
  init_ManagedRuntime();
  init_Match();
  init_MergeDecision();
  init_MergeState();
  init_MergeStrategy();
  init_Metric();
  init_MetricBoundaries();
  init_MetricHook();
  init_MetricKey();
  init_MetricKeyType();
  init_MetricLabel();
  init_MetricPair();
  init_MetricPolling();
  init_MetricRegistry();
  init_MetricState();
  init_Micro();
  init_ModuleVersion();
  init_MutableHashMap();
  init_MutableHashSet();
  init_MutableList();
  init_MutableQueue();
  init_MutableRef();
  init_Number();
  init_Option();
  init_Order();
  init_Ordering();
  init_ParseResult();
  init_Pool();
  init_Predicate();
  init_Pretty();
  init_PrimaryKey();
  init_PubSub();
  init_Queue();
  init_Random();
  init_RateLimiter();
  init_RcMap();
  init_RcRef();
  init_Readable();
  init_Record();
  init_RedBlackTree();
  init_Redacted();
  init_Ref();
  init_RegExp();
  init_Reloadable();
  init_Request();
  init_RequestBlock();
  init_RequestResolver();
  init_Resource();
  init_Runtime();
  init_RuntimeFlags();
  init_RuntimeFlagsPatch();
  init_STM();
  init_Schedule();
  init_ScheduleDecision();
  init_ScheduleInterval();
  init_ScheduleIntervals();
  init_Scheduler();
  init_Schema();
  init_SchemaAST();
  init_Scope();
  init_ScopedCache();
  init_ScopedRef();
  init_Secret();
  init_SingleProducerAsyncInput();
  init_Sink();
  init_SortedMap();
  init_SortedSet();
  init_Stream();
  init_StreamEmit();
  init_StreamHaltStrategy();
  init_Streamable();
  init_String();
  init_Struct();
  init_Subscribable();
  init_SubscriptionRef();
  init_Supervisor();
  init_Symbol();
  init_SynchronizedRef();
  init_TArray();
  init_TDeferred();
  init_TMap();
  init_TPriorityQueue();
  init_TPubSub();
  init_TQueue();
  init_TRandom();
  init_TReentrantLock();
  init_TRef();
  init_TSemaphore();
  init_TSet();
  init_TSubscriptionRef();
  init_Take();
  init_TestAnnotation();
  init_TestAnnotationMap();
  init_TestAnnotations();
  init_TestClock();
  init_TestConfig();
  init_TestContext();
  init_TestLive();
  init_TestServices();
  init_TestSized();
  init_Tracer();
  init_Trie();
  init_Tuple();
  init_Types();
  init_Unify();
  init_UpstreamPullRequest();
  init_UpstreamPullStrategy();
  init_Utils();
});

// packages/core/src/service.ts
var exports_service = {};
__export(exports_service, {
  getServiceTag: () => getServiceTag,
  getServiceMetadata: () => getServiceMetadata,
  createServiceLayer: () => createServiceLayer,
  Service: () => Service2,
  BaseService: () => BaseService
});
function Service2(tag2) {
  return function(target) {
    const serviceTag = tag2 || exports_Context.GenericTag(target.name);
    META_SERVICES.set(target, {
      tag: serviceTag,
      impl: target
    });
    return target;
  };
}
function getServiceMetadata(target) {
  return META_SERVICES.get(target);
}
function getServiceTag(serviceClass) {
  const metadata = getServiceMetadata(serviceClass);
  if (!metadata) {
    throw new Error(`Service ${serviceClass.name} does not have @Service decorator`);
  }
  return metadata.tag;
}

class BaseService {
  logger;
  config;
  constructor(logger, config2) {
    const className = this.constructor.name;
    if (logger) {
      this.logger = logger.child({ className });
    } else {
      throw new Error(`Logger is required for service ${className}. Make sure OneBunApplication is configured correctly.`);
    }
    this.config = config2;
  }
  async runEffect(effect4) {
    try {
      return await exports_Effect.runPromise(effect4);
    } catch (error2) {
      throw this.formatError(error2);
    }
  }
  formatError(error2) {
    if (error2 instanceof Error) {
      return error2;
    }
    return new Error(String(error2));
  }
}
function createServiceLayer(serviceClass, logger, config2) {
  const metadata = getServiceMetadata(serviceClass);
  if (!metadata) {
    throw new Error(`Service ${serviceClass.name} does not have @Service decorator`);
  }
  const ServiceConstructor = metadata.impl;
  const serviceInstance = new ServiceConstructor(logger, config2);
  return exports_Layer.succeed(metadata.tag, serviceInstance);
}
var META_SERVICES;
var init_service = __esm(() => {
  init_esm();
  META_SERVICES = new Map;
});

// node_modules/@opentelemetry/api/build/src/platform/node/globalThis.js
var require_globalThis = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports._globalThis = undefined;
  exports._globalThis = typeof globalThis === "object" ? globalThis : global;
});

// node_modules/@opentelemetry/api/build/src/platform/node/index.js
var require_node = __commonJS((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() {
      return m[k];
    } });
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports && exports.__exportStar || function(m, exports2) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p))
        __createBinding(exports2, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  __exportStar(require_globalThis(), exports);
});

// node_modules/@opentelemetry/api/build/src/platform/index.js
var require_platform = __commonJS((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() {
      return m[k];
    } });
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports && exports.__exportStar || function(m, exports2) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p))
        __createBinding(exports2, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  __exportStar(require_node(), exports);
});

// node_modules/@opentelemetry/api/build/src/version.js
var require_version = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.VERSION = undefined;
  exports.VERSION = "1.9.0";
});

// node_modules/@opentelemetry/api/build/src/internal/semver.js
var require_semver = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isCompatible = exports._makeCompatibilityCheck = undefined;
  var version_1 = require_version();
  var re = /^(\d+)\.(\d+)\.(\d+)(-(.+))?$/;
  function _makeCompatibilityCheck(ownVersion) {
    const acceptedVersions = new Set([ownVersion]);
    const rejectedVersions = new Set;
    const myVersionMatch = ownVersion.match(re);
    if (!myVersionMatch) {
      return () => false;
    }
    const ownVersionParsed = {
      major: +myVersionMatch[1],
      minor: +myVersionMatch[2],
      patch: +myVersionMatch[3],
      prerelease: myVersionMatch[4]
    };
    if (ownVersionParsed.prerelease != null) {
      return function isExactmatch(globalVersion) {
        return globalVersion === ownVersion;
      };
    }
    function _reject(v) {
      rejectedVersions.add(v);
      return false;
    }
    function _accept(v) {
      acceptedVersions.add(v);
      return true;
    }
    return function isCompatible(globalVersion) {
      if (acceptedVersions.has(globalVersion)) {
        return true;
      }
      if (rejectedVersions.has(globalVersion)) {
        return false;
      }
      const globalVersionMatch = globalVersion.match(re);
      if (!globalVersionMatch) {
        return _reject(globalVersion);
      }
      const globalVersionParsed = {
        major: +globalVersionMatch[1],
        minor: +globalVersionMatch[2],
        patch: +globalVersionMatch[3],
        prerelease: globalVersionMatch[4]
      };
      if (globalVersionParsed.prerelease != null) {
        return _reject(globalVersion);
      }
      if (ownVersionParsed.major !== globalVersionParsed.major) {
        return _reject(globalVersion);
      }
      if (ownVersionParsed.major === 0) {
        if (ownVersionParsed.minor === globalVersionParsed.minor && ownVersionParsed.patch <= globalVersionParsed.patch) {
          return _accept(globalVersion);
        }
        return _reject(globalVersion);
      }
      if (ownVersionParsed.minor <= globalVersionParsed.minor) {
        return _accept(globalVersion);
      }
      return _reject(globalVersion);
    };
  }
  exports._makeCompatibilityCheck = _makeCompatibilityCheck;
  exports.isCompatible = _makeCompatibilityCheck(version_1.VERSION);
});

// node_modules/@opentelemetry/api/build/src/internal/global-utils.js
var require_global_utils = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.unregisterGlobal = exports.getGlobal = exports.registerGlobal = undefined;
  var platform_1 = require_platform();
  var version_1 = require_version();
  var semver_1 = require_semver();
  var major = version_1.VERSION.split(".")[0];
  var GLOBAL_OPENTELEMETRY_API_KEY = Symbol.for(`opentelemetry.js.api.${major}`);
  var _global = platform_1._globalThis;
  function registerGlobal(type2, instance, diag, allowOverride = false) {
    var _a;
    const api = _global[GLOBAL_OPENTELEMETRY_API_KEY] = (_a = _global[GLOBAL_OPENTELEMETRY_API_KEY]) !== null && _a !== undefined ? _a : {
      version: version_1.VERSION
    };
    if (!allowOverride && api[type2]) {
      const err = new Error(`@opentelemetry/api: Attempted duplicate registration of API: ${type2}`);
      diag.error(err.stack || err.message);
      return false;
    }
    if (api.version !== version_1.VERSION) {
      const err = new Error(`@opentelemetry/api: Registration of version v${api.version} for ${type2} does not match previously registered API v${version_1.VERSION}`);
      diag.error(err.stack || err.message);
      return false;
    }
    api[type2] = instance;
    diag.debug(`@opentelemetry/api: Registered a global for ${type2} v${version_1.VERSION}.`);
    return true;
  }
  exports.registerGlobal = registerGlobal;
  function getGlobal(type2) {
    var _a, _b;
    const globalVersion = (_a = _global[GLOBAL_OPENTELEMETRY_API_KEY]) === null || _a === undefined ? undefined : _a.version;
    if (!globalVersion || !(0, semver_1.isCompatible)(globalVersion)) {
      return;
    }
    return (_b = _global[GLOBAL_OPENTELEMETRY_API_KEY]) === null || _b === undefined ? undefined : _b[type2];
  }
  exports.getGlobal = getGlobal;
  function unregisterGlobal(type2, diag) {
    diag.debug(`@opentelemetry/api: Unregistering a global for ${type2} v${version_1.VERSION}.`);
    const api = _global[GLOBAL_OPENTELEMETRY_API_KEY];
    if (api) {
      delete api[type2];
    }
  }
  exports.unregisterGlobal = unregisterGlobal;
});

// node_modules/@opentelemetry/api/build/src/diag/ComponentLogger.js
var require_ComponentLogger = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiagComponentLogger = undefined;
  var global_utils_1 = require_global_utils();

  class DiagComponentLogger {
    constructor(props) {
      this._namespace = props.namespace || "DiagComponentLogger";
    }
    debug(...args2) {
      return logProxy("debug", this._namespace, args2);
    }
    error(...args2) {
      return logProxy("error", this._namespace, args2);
    }
    info(...args2) {
      return logProxy("info", this._namespace, args2);
    }
    warn(...args2) {
      return logProxy("warn", this._namespace, args2);
    }
    verbose(...args2) {
      return logProxy("verbose", this._namespace, args2);
    }
  }
  exports.DiagComponentLogger = DiagComponentLogger;
  function logProxy(funcName, namespace, args2) {
    const logger2 = (0, global_utils_1.getGlobal)("diag");
    if (!logger2) {
      return;
    }
    args2.unshift(namespace);
    return logger2[funcName](...args2);
  }
});

// node_modules/@opentelemetry/api/build/src/diag/types.js
var require_types = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiagLogLevel = undefined;
  var DiagLogLevel;
  (function(DiagLogLevel2) {
    DiagLogLevel2[DiagLogLevel2["NONE"] = 0] = "NONE";
    DiagLogLevel2[DiagLogLevel2["ERROR"] = 30] = "ERROR";
    DiagLogLevel2[DiagLogLevel2["WARN"] = 50] = "WARN";
    DiagLogLevel2[DiagLogLevel2["INFO"] = 60] = "INFO";
    DiagLogLevel2[DiagLogLevel2["DEBUG"] = 70] = "DEBUG";
    DiagLogLevel2[DiagLogLevel2["VERBOSE"] = 80] = "VERBOSE";
    DiagLogLevel2[DiagLogLevel2["ALL"] = 9999] = "ALL";
  })(DiagLogLevel = exports.DiagLogLevel || (exports.DiagLogLevel = {}));
});

// node_modules/@opentelemetry/api/build/src/diag/internal/logLevelLogger.js
var require_logLevelLogger = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.createLogLevelDiagLogger = undefined;
  var types_1 = require_types();
  function createLogLevelDiagLogger(maxLevel, logger2) {
    if (maxLevel < types_1.DiagLogLevel.NONE) {
      maxLevel = types_1.DiagLogLevel.NONE;
    } else if (maxLevel > types_1.DiagLogLevel.ALL) {
      maxLevel = types_1.DiagLogLevel.ALL;
    }
    logger2 = logger2 || {};
    function _filterFunc(funcName, theLevel) {
      const theFunc = logger2[funcName];
      if (typeof theFunc === "function" && maxLevel >= theLevel) {
        return theFunc.bind(logger2);
      }
      return function() {};
    }
    return {
      error: _filterFunc("error", types_1.DiagLogLevel.ERROR),
      warn: _filterFunc("warn", types_1.DiagLogLevel.WARN),
      info: _filterFunc("info", types_1.DiagLogLevel.INFO),
      debug: _filterFunc("debug", types_1.DiagLogLevel.DEBUG),
      verbose: _filterFunc("verbose", types_1.DiagLogLevel.VERBOSE)
    };
  }
  exports.createLogLevelDiagLogger = createLogLevelDiagLogger;
});

// node_modules/@opentelemetry/api/build/src/api/diag.js
var require_diag = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiagAPI = undefined;
  var ComponentLogger_1 = require_ComponentLogger();
  var logLevelLogger_1 = require_logLevelLogger();
  var types_1 = require_types();
  var global_utils_1 = require_global_utils();
  var API_NAME = "diag";

  class DiagAPI {
    constructor() {
      function _logProxy(funcName) {
        return function(...args2) {
          const logger2 = (0, global_utils_1.getGlobal)("diag");
          if (!logger2)
            return;
          return logger2[funcName](...args2);
        };
      }
      const self = this;
      const setLogger = (logger2, optionsOrLogLevel = { logLevel: types_1.DiagLogLevel.INFO }) => {
        var _a, _b, _c;
        if (logger2 === self) {
          const err = new Error("Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation");
          self.error((_a = err.stack) !== null && _a !== undefined ? _a : err.message);
          return false;
        }
        if (typeof optionsOrLogLevel === "number") {
          optionsOrLogLevel = {
            logLevel: optionsOrLogLevel
          };
        }
        const oldLogger = (0, global_utils_1.getGlobal)("diag");
        const newLogger = (0, logLevelLogger_1.createLogLevelDiagLogger)((_b = optionsOrLogLevel.logLevel) !== null && _b !== undefined ? _b : types_1.DiagLogLevel.INFO, logger2);
        if (oldLogger && !optionsOrLogLevel.suppressOverrideMessage) {
          const stack = (_c = new Error().stack) !== null && _c !== undefined ? _c : "<failed to generate stacktrace>";
          oldLogger.warn(`Current logger will be overwritten from ${stack}`);
          newLogger.warn(`Current logger will overwrite one already registered from ${stack}`);
        }
        return (0, global_utils_1.registerGlobal)("diag", newLogger, self, true);
      };
      self.setLogger = setLogger;
      self.disable = () => {
        (0, global_utils_1.unregisterGlobal)(API_NAME, self);
      };
      self.createComponentLogger = (options) => {
        return new ComponentLogger_1.DiagComponentLogger(options);
      };
      self.verbose = _logProxy("verbose");
      self.debug = _logProxy("debug");
      self.info = _logProxy("info");
      self.warn = _logProxy("warn");
      self.error = _logProxy("error");
    }
    static instance() {
      if (!this._instance) {
        this._instance = new DiagAPI;
      }
      return this._instance;
    }
  }
  exports.DiagAPI = DiagAPI;
});

// node_modules/@opentelemetry/api/build/src/baggage/internal/baggage-impl.js
var require_baggage_impl = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.BaggageImpl = undefined;

  class BaggageImpl {
    constructor(entries3) {
      this._entries = entries3 ? new Map(entries3) : new Map;
    }
    getEntry(key) {
      const entry = this._entries.get(key);
      if (!entry) {
        return;
      }
      return Object.assign({}, entry);
    }
    getAllEntries() {
      return Array.from(this._entries.entries()).map(([k, v]) => [k, v]);
    }
    setEntry(key, entry) {
      const newBaggage = new BaggageImpl(this._entries);
      newBaggage._entries.set(key, entry);
      return newBaggage;
    }
    removeEntry(key) {
      const newBaggage = new BaggageImpl(this._entries);
      newBaggage._entries.delete(key);
      return newBaggage;
    }
    removeEntries(...keys9) {
      const newBaggage = new BaggageImpl(this._entries);
      for (const key of keys9) {
        newBaggage._entries.delete(key);
      }
      return newBaggage;
    }
    clear() {
      return new BaggageImpl;
    }
  }
  exports.BaggageImpl = BaggageImpl;
});

// node_modules/@opentelemetry/api/build/src/baggage/internal/symbol.js
var require_symbol = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.baggageEntryMetadataSymbol = undefined;
  exports.baggageEntryMetadataSymbol = Symbol("BaggageEntryMetadata");
});

// node_modules/@opentelemetry/api/build/src/baggage/utils.js
var require_utils = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.baggageEntryMetadataFromString = exports.createBaggage = undefined;
  var diag_1 = require_diag();
  var baggage_impl_1 = require_baggage_impl();
  var symbol_1 = require_symbol();
  var diag = diag_1.DiagAPI.instance();
  function createBaggage(entries3 = {}) {
    return new baggage_impl_1.BaggageImpl(new Map(Object.entries(entries3)));
  }
  exports.createBaggage = createBaggage;
  function baggageEntryMetadataFromString(str) {
    if (typeof str !== "string") {
      diag.error(`Cannot create baggage metadata from unknown type: ${typeof str}`);
      str = "";
    }
    return {
      __TYPE__: symbol_1.baggageEntryMetadataSymbol,
      toString() {
        return str;
      }
    };
  }
  exports.baggageEntryMetadataFromString = baggageEntryMetadataFromString;
});

// node_modules/@opentelemetry/api/build/src/context/context.js
var require_context = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ROOT_CONTEXT = exports.createContextKey = undefined;
  function createContextKey(description) {
    return Symbol.for(description);
  }
  exports.createContextKey = createContextKey;

  class BaseContext {
    constructor(parentContext) {
      const self = this;
      self._currentContext = parentContext ? new Map(parentContext) : new Map;
      self.getValue = (key) => self._currentContext.get(key);
      self.setValue = (key, value6) => {
        const context9 = new BaseContext(self._currentContext);
        context9._currentContext.set(key, value6);
        return context9;
      };
      self.deleteValue = (key) => {
        const context9 = new BaseContext(self._currentContext);
        context9._currentContext.delete(key);
        return context9;
      };
    }
  }
  exports.ROOT_CONTEXT = new BaseContext;
});

// node_modules/@opentelemetry/api/build/src/diag/consoleLogger.js
var require_consoleLogger = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiagConsoleLogger = undefined;
  var consoleMap = [
    { n: "error", c: "error" },
    { n: "warn", c: "warn" },
    { n: "info", c: "info" },
    { n: "debug", c: "debug" },
    { n: "verbose", c: "trace" }
  ];

  class DiagConsoleLogger {
    constructor() {
      function _consoleFunc(funcName) {
        return function(...args2) {
          if (console) {
            let theFunc = console[funcName];
            if (typeof theFunc !== "function") {
              theFunc = console.log;
            }
            if (typeof theFunc === "function") {
              return theFunc.apply(console, args2);
            }
          }
        };
      }
      for (let i = 0;i < consoleMap.length; i++) {
        this[consoleMap[i].n] = _consoleFunc(consoleMap[i].c);
      }
    }
  }
  exports.DiagConsoleLogger = DiagConsoleLogger;
});

// node_modules/@opentelemetry/api/build/src/metrics/NoopMeter.js
var require_NoopMeter = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.createNoopMeter = exports.NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC = exports.NOOP_OBSERVABLE_GAUGE_METRIC = exports.NOOP_OBSERVABLE_COUNTER_METRIC = exports.NOOP_UP_DOWN_COUNTER_METRIC = exports.NOOP_HISTOGRAM_METRIC = exports.NOOP_GAUGE_METRIC = exports.NOOP_COUNTER_METRIC = exports.NOOP_METER = exports.NoopObservableUpDownCounterMetric = exports.NoopObservableGaugeMetric = exports.NoopObservableCounterMetric = exports.NoopObservableMetric = exports.NoopHistogramMetric = exports.NoopGaugeMetric = exports.NoopUpDownCounterMetric = exports.NoopCounterMetric = exports.NoopMetric = exports.NoopMeter = undefined;

  class NoopMeter {
    constructor() {}
    createGauge(_name, _options) {
      return exports.NOOP_GAUGE_METRIC;
    }
    createHistogram(_name, _options) {
      return exports.NOOP_HISTOGRAM_METRIC;
    }
    createCounter(_name, _options) {
      return exports.NOOP_COUNTER_METRIC;
    }
    createUpDownCounter(_name, _options) {
      return exports.NOOP_UP_DOWN_COUNTER_METRIC;
    }
    createObservableGauge(_name, _options) {
      return exports.NOOP_OBSERVABLE_GAUGE_METRIC;
    }
    createObservableCounter(_name, _options) {
      return exports.NOOP_OBSERVABLE_COUNTER_METRIC;
    }
    createObservableUpDownCounter(_name, _options) {
      return exports.NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC;
    }
    addBatchObservableCallback(_callback, _observables) {}
    removeBatchObservableCallback(_callback) {}
  }
  exports.NoopMeter = NoopMeter;

  class NoopMetric {
  }
  exports.NoopMetric = NoopMetric;

  class NoopCounterMetric extends NoopMetric {
    add(_value, _attributes) {}
  }
  exports.NoopCounterMetric = NoopCounterMetric;

  class NoopUpDownCounterMetric extends NoopMetric {
    add(_value, _attributes) {}
  }
  exports.NoopUpDownCounterMetric = NoopUpDownCounterMetric;

  class NoopGaugeMetric extends NoopMetric {
    record(_value, _attributes) {}
  }
  exports.NoopGaugeMetric = NoopGaugeMetric;

  class NoopHistogramMetric extends NoopMetric {
    record(_value, _attributes) {}
  }
  exports.NoopHistogramMetric = NoopHistogramMetric;

  class NoopObservableMetric {
    addCallback(_callback) {}
    removeCallback(_callback) {}
  }
  exports.NoopObservableMetric = NoopObservableMetric;

  class NoopObservableCounterMetric extends NoopObservableMetric {
  }
  exports.NoopObservableCounterMetric = NoopObservableCounterMetric;

  class NoopObservableGaugeMetric extends NoopObservableMetric {
  }
  exports.NoopObservableGaugeMetric = NoopObservableGaugeMetric;

  class NoopObservableUpDownCounterMetric extends NoopObservableMetric {
  }
  exports.NoopObservableUpDownCounterMetric = NoopObservableUpDownCounterMetric;
  exports.NOOP_METER = new NoopMeter;
  exports.NOOP_COUNTER_METRIC = new NoopCounterMetric;
  exports.NOOP_GAUGE_METRIC = new NoopGaugeMetric;
  exports.NOOP_HISTOGRAM_METRIC = new NoopHistogramMetric;
  exports.NOOP_UP_DOWN_COUNTER_METRIC = new NoopUpDownCounterMetric;
  exports.NOOP_OBSERVABLE_COUNTER_METRIC = new NoopObservableCounterMetric;
  exports.NOOP_OBSERVABLE_GAUGE_METRIC = new NoopObservableGaugeMetric;
  exports.NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC = new NoopObservableUpDownCounterMetric;
  function createNoopMeter() {
    return exports.NOOP_METER;
  }
  exports.createNoopMeter = createNoopMeter;
});

// node_modules/@opentelemetry/api/build/src/metrics/Metric.js
var require_Metric = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ValueType = undefined;
  var ValueType;
  (function(ValueType2) {
    ValueType2[ValueType2["INT"] = 0] = "INT";
    ValueType2[ValueType2["DOUBLE"] = 1] = "DOUBLE";
  })(ValueType = exports.ValueType || (exports.ValueType = {}));
});

// node_modules/@opentelemetry/api/build/src/propagation/TextMapPropagator.js
var require_TextMapPropagator = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.defaultTextMapSetter = exports.defaultTextMapGetter = undefined;
  exports.defaultTextMapGetter = {
    get(carrier, key) {
      if (carrier == null) {
        return;
      }
      return carrier[key];
    },
    keys(carrier) {
      if (carrier == null) {
        return [];
      }
      return Object.keys(carrier);
    }
  };
  exports.defaultTextMapSetter = {
    set(carrier, key, value6) {
      if (carrier == null) {
        return;
      }
      carrier[key] = value6;
    }
  };
});

// node_modules/@opentelemetry/api/build/src/context/NoopContextManager.js
var require_NoopContextManager = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NoopContextManager = undefined;
  var context_1 = require_context();

  class NoopContextManager {
    active() {
      return context_1.ROOT_CONTEXT;
    }
    with(_context, fn2, thisArg, ...args2) {
      return fn2.call(thisArg, ...args2);
    }
    bind(_context, target) {
      return target;
    }
    enable() {
      return this;
    }
    disable() {
      return this;
    }
  }
  exports.NoopContextManager = NoopContextManager;
});

// node_modules/@opentelemetry/api/build/src/api/context.js
var require_context2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ContextAPI = undefined;
  var NoopContextManager_1 = require_NoopContextManager();
  var global_utils_1 = require_global_utils();
  var diag_1 = require_diag();
  var API_NAME = "context";
  var NOOP_CONTEXT_MANAGER = new NoopContextManager_1.NoopContextManager;

  class ContextAPI {
    constructor() {}
    static getInstance() {
      if (!this._instance) {
        this._instance = new ContextAPI;
      }
      return this._instance;
    }
    setGlobalContextManager(contextManager) {
      return (0, global_utils_1.registerGlobal)(API_NAME, contextManager, diag_1.DiagAPI.instance());
    }
    active() {
      return this._getContextManager().active();
    }
    with(context9, fn2, thisArg, ...args2) {
      return this._getContextManager().with(context9, fn2, thisArg, ...args2);
    }
    bind(context9, target) {
      return this._getContextManager().bind(context9, target);
    }
    _getContextManager() {
      return (0, global_utils_1.getGlobal)(API_NAME) || NOOP_CONTEXT_MANAGER;
    }
    disable() {
      this._getContextManager().disable();
      (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
    }
  }
  exports.ContextAPI = ContextAPI;
});

// node_modules/@opentelemetry/api/build/src/trace/trace_flags.js
var require_trace_flags = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.TraceFlags = undefined;
  var TraceFlags;
  (function(TraceFlags2) {
    TraceFlags2[TraceFlags2["NONE"] = 0] = "NONE";
    TraceFlags2[TraceFlags2["SAMPLED"] = 1] = "SAMPLED";
  })(TraceFlags = exports.TraceFlags || (exports.TraceFlags = {}));
});

// node_modules/@opentelemetry/api/build/src/trace/invalid-span-constants.js
var require_invalid_span_constants = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.INVALID_SPAN_CONTEXT = exports.INVALID_TRACEID = exports.INVALID_SPANID = undefined;
  var trace_flags_1 = require_trace_flags();
  exports.INVALID_SPANID = "0000000000000000";
  exports.INVALID_TRACEID = "00000000000000000000000000000000";
  exports.INVALID_SPAN_CONTEXT = {
    traceId: exports.INVALID_TRACEID,
    spanId: exports.INVALID_SPANID,
    traceFlags: trace_flags_1.TraceFlags.NONE
  };
});

// node_modules/@opentelemetry/api/build/src/trace/NonRecordingSpan.js
var require_NonRecordingSpan = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NonRecordingSpan = undefined;
  var invalid_span_constants_1 = require_invalid_span_constants();

  class NonRecordingSpan {
    constructor(_spanContext = invalid_span_constants_1.INVALID_SPAN_CONTEXT) {
      this._spanContext = _spanContext;
    }
    spanContext() {
      return this._spanContext;
    }
    setAttribute(_key, _value) {
      return this;
    }
    setAttributes(_attributes) {
      return this;
    }
    addEvent(_name, _attributes) {
      return this;
    }
    addLink(_link) {
      return this;
    }
    addLinks(_links) {
      return this;
    }
    setStatus(_status) {
      return this;
    }
    updateName(_name) {
      return this;
    }
    end(_endTime) {}
    isRecording() {
      return false;
    }
    recordException(_exception, _time) {}
  }
  exports.NonRecordingSpan = NonRecordingSpan;
});

// node_modules/@opentelemetry/api/build/src/trace/context-utils.js
var require_context_utils = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getSpanContext = exports.setSpanContext = exports.deleteSpan = exports.setSpan = exports.getActiveSpan = exports.getSpan = undefined;
  var context_1 = require_context();
  var NonRecordingSpan_1 = require_NonRecordingSpan();
  var context_2 = require_context2();
  var SPAN_KEY = (0, context_1.createContextKey)("OpenTelemetry Context Key SPAN");
  function getSpan(context9) {
    return context9.getValue(SPAN_KEY) || undefined;
  }
  exports.getSpan = getSpan;
  function getActiveSpan() {
    return getSpan(context_2.ContextAPI.getInstance().active());
  }
  exports.getActiveSpan = getActiveSpan;
  function setSpan(context9, span4) {
    return context9.setValue(SPAN_KEY, span4);
  }
  exports.setSpan = setSpan;
  function deleteSpan(context9) {
    return context9.deleteValue(SPAN_KEY);
  }
  exports.deleteSpan = deleteSpan;
  function setSpanContext(context9, spanContext) {
    return setSpan(context9, new NonRecordingSpan_1.NonRecordingSpan(spanContext));
  }
  exports.setSpanContext = setSpanContext;
  function getSpanContext(context9) {
    var _a;
    return (_a = getSpan(context9)) === null || _a === undefined ? undefined : _a.spanContext();
  }
  exports.getSpanContext = getSpanContext;
});

// node_modules/@opentelemetry/api/build/src/trace/spancontext-utils.js
var require_spancontext_utils = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.wrapSpanContext = exports.isSpanContextValid = exports.isValidSpanId = exports.isValidTraceId = undefined;
  var invalid_span_constants_1 = require_invalid_span_constants();
  var NonRecordingSpan_1 = require_NonRecordingSpan();
  var VALID_TRACEID_REGEX = /^([0-9a-f]{32})$/i;
  var VALID_SPANID_REGEX = /^[0-9a-f]{16}$/i;
  function isValidTraceId(traceId) {
    return VALID_TRACEID_REGEX.test(traceId) && traceId !== invalid_span_constants_1.INVALID_TRACEID;
  }
  exports.isValidTraceId = isValidTraceId;
  function isValidSpanId(spanId) {
    return VALID_SPANID_REGEX.test(spanId) && spanId !== invalid_span_constants_1.INVALID_SPANID;
  }
  exports.isValidSpanId = isValidSpanId;
  function isSpanContextValid(spanContext) {
    return isValidTraceId(spanContext.traceId) && isValidSpanId(spanContext.spanId);
  }
  exports.isSpanContextValid = isSpanContextValid;
  function wrapSpanContext(spanContext) {
    return new NonRecordingSpan_1.NonRecordingSpan(spanContext);
  }
  exports.wrapSpanContext = wrapSpanContext;
});

// node_modules/@opentelemetry/api/build/src/trace/NoopTracer.js
var require_NoopTracer = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NoopTracer = undefined;
  var context_1 = require_context2();
  var context_utils_1 = require_context_utils();
  var NonRecordingSpan_1 = require_NonRecordingSpan();
  var spancontext_utils_1 = require_spancontext_utils();
  var contextApi = context_1.ContextAPI.getInstance();

  class NoopTracer {
    startSpan(name, options, context9 = contextApi.active()) {
      const root = Boolean(options === null || options === undefined ? undefined : options.root);
      if (root) {
        return new NonRecordingSpan_1.NonRecordingSpan;
      }
      const parentFromContext = context9 && (0, context_utils_1.getSpanContext)(context9);
      if (isSpanContext(parentFromContext) && (0, spancontext_utils_1.isSpanContextValid)(parentFromContext)) {
        return new NonRecordingSpan_1.NonRecordingSpan(parentFromContext);
      } else {
        return new NonRecordingSpan_1.NonRecordingSpan;
      }
    }
    startActiveSpan(name, arg2, arg3, arg4) {
      let opts;
      let ctx;
      let fn2;
      if (arguments.length < 2) {
        return;
      } else if (arguments.length === 2) {
        fn2 = arg2;
      } else if (arguments.length === 3) {
        opts = arg2;
        fn2 = arg3;
      } else {
        opts = arg2;
        ctx = arg3;
        fn2 = arg4;
      }
      const parentContext = ctx !== null && ctx !== undefined ? ctx : contextApi.active();
      const span4 = this.startSpan(name, opts, parentContext);
      const contextWithSpanSet = (0, context_utils_1.setSpan)(parentContext, span4);
      return contextApi.with(contextWithSpanSet, fn2, undefined, span4);
    }
  }
  exports.NoopTracer = NoopTracer;
  function isSpanContext(spanContext) {
    return typeof spanContext === "object" && typeof spanContext["spanId"] === "string" && typeof spanContext["traceId"] === "string" && typeof spanContext["traceFlags"] === "number";
  }
});

// node_modules/@opentelemetry/api/build/src/trace/ProxyTracer.js
var require_ProxyTracer = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ProxyTracer = undefined;
  var NoopTracer_1 = require_NoopTracer();
  var NOOP_TRACER = new NoopTracer_1.NoopTracer;

  class ProxyTracer {
    constructor(_provider, name, version, options) {
      this._provider = _provider;
      this.name = name;
      this.version = version;
      this.options = options;
    }
    startSpan(name, options, context9) {
      return this._getTracer().startSpan(name, options, context9);
    }
    startActiveSpan(_name, _options, _context, _fn) {
      const tracer3 = this._getTracer();
      return Reflect.apply(tracer3.startActiveSpan, tracer3, arguments);
    }
    _getTracer() {
      if (this._delegate) {
        return this._delegate;
      }
      const tracer3 = this._provider.getDelegateTracer(this.name, this.version, this.options);
      if (!tracer3) {
        return NOOP_TRACER;
      }
      this._delegate = tracer3;
      return this._delegate;
    }
  }
  exports.ProxyTracer = ProxyTracer;
});

// node_modules/@opentelemetry/api/build/src/trace/NoopTracerProvider.js
var require_NoopTracerProvider = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NoopTracerProvider = undefined;
  var NoopTracer_1 = require_NoopTracer();

  class NoopTracerProvider {
    getTracer(_name, _version2, _options) {
      return new NoopTracer_1.NoopTracer;
    }
  }
  exports.NoopTracerProvider = NoopTracerProvider;
});

// node_modules/@opentelemetry/api/build/src/trace/ProxyTracerProvider.js
var require_ProxyTracerProvider = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ProxyTracerProvider = undefined;
  var ProxyTracer_1 = require_ProxyTracer();
  var NoopTracerProvider_1 = require_NoopTracerProvider();
  var NOOP_TRACER_PROVIDER = new NoopTracerProvider_1.NoopTracerProvider;

  class ProxyTracerProvider {
    getTracer(name, version, options) {
      var _a;
      return (_a = this.getDelegateTracer(name, version, options)) !== null && _a !== undefined ? _a : new ProxyTracer_1.ProxyTracer(this, name, version, options);
    }
    getDelegate() {
      var _a;
      return (_a = this._delegate) !== null && _a !== undefined ? _a : NOOP_TRACER_PROVIDER;
    }
    setDelegate(delegate) {
      this._delegate = delegate;
    }
    getDelegateTracer(name, version, options) {
      var _a;
      return (_a = this._delegate) === null || _a === undefined ? undefined : _a.getTracer(name, version, options);
    }
  }
  exports.ProxyTracerProvider = ProxyTracerProvider;
});

// node_modules/@opentelemetry/api/build/src/trace/SamplingResult.js
var require_SamplingResult = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.SamplingDecision = undefined;
  var SamplingDecision;
  (function(SamplingDecision2) {
    SamplingDecision2[SamplingDecision2["NOT_RECORD"] = 0] = "NOT_RECORD";
    SamplingDecision2[SamplingDecision2["RECORD"] = 1] = "RECORD";
    SamplingDecision2[SamplingDecision2["RECORD_AND_SAMPLED"] = 2] = "RECORD_AND_SAMPLED";
  })(SamplingDecision = exports.SamplingDecision || (exports.SamplingDecision = {}));
});

// node_modules/@opentelemetry/api/build/src/trace/span_kind.js
var require_span_kind = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.SpanKind = undefined;
  var SpanKind;
  (function(SpanKind2) {
    SpanKind2[SpanKind2["INTERNAL"] = 0] = "INTERNAL";
    SpanKind2[SpanKind2["SERVER"] = 1] = "SERVER";
    SpanKind2[SpanKind2["CLIENT"] = 2] = "CLIENT";
    SpanKind2[SpanKind2["PRODUCER"] = 3] = "PRODUCER";
    SpanKind2[SpanKind2["CONSUMER"] = 4] = "CONSUMER";
  })(SpanKind = exports.SpanKind || (exports.SpanKind = {}));
});

// node_modules/@opentelemetry/api/build/src/trace/status.js
var require_status = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.SpanStatusCode = undefined;
  var SpanStatusCode;
  (function(SpanStatusCode2) {
    SpanStatusCode2[SpanStatusCode2["UNSET"] = 0] = "UNSET";
    SpanStatusCode2[SpanStatusCode2["OK"] = 1] = "OK";
    SpanStatusCode2[SpanStatusCode2["ERROR"] = 2] = "ERROR";
  })(SpanStatusCode = exports.SpanStatusCode || (exports.SpanStatusCode = {}));
});

// node_modules/@opentelemetry/api/build/src/trace/internal/tracestate-validators.js
var require_tracestate_validators = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateValue = exports.validateKey = undefined;
  var VALID_KEY_CHAR_RANGE = "[_0-9a-z-*/]";
  var VALID_KEY = `[a-z]${VALID_KEY_CHAR_RANGE}{0,255}`;
  var VALID_VENDOR_KEY = `[a-z0-9]${VALID_KEY_CHAR_RANGE}{0,240}@[a-z]${VALID_KEY_CHAR_RANGE}{0,13}`;
  var VALID_KEY_REGEX = new RegExp(`^(?:${VALID_KEY}|${VALID_VENDOR_KEY})$`);
  var VALID_VALUE_BASE_REGEX = /^[ -~]{0,255}[!-~]$/;
  var INVALID_VALUE_COMMA_EQUAL_REGEX = /,|=/;
  function validateKey(key) {
    return VALID_KEY_REGEX.test(key);
  }
  exports.validateKey = validateKey;
  function validateValue(value6) {
    return VALID_VALUE_BASE_REGEX.test(value6) && !INVALID_VALUE_COMMA_EQUAL_REGEX.test(value6);
  }
  exports.validateValue = validateValue;
});

// node_modules/@opentelemetry/api/build/src/trace/internal/tracestate-impl.js
var require_tracestate_impl = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.TraceStateImpl = undefined;
  var tracestate_validators_1 = require_tracestate_validators();
  var MAX_TRACE_STATE_ITEMS = 32;
  var MAX_TRACE_STATE_LEN = 512;
  var LIST_MEMBERS_SEPARATOR = ",";
  var LIST_MEMBER_KEY_VALUE_SPLITTER = "=";

  class TraceStateImpl {
    constructor(rawTraceState) {
      this._internalState = new Map;
      if (rawTraceState)
        this._parse(rawTraceState);
    }
    set(key, value6) {
      const traceState = this._clone();
      if (traceState._internalState.has(key)) {
        traceState._internalState.delete(key);
      }
      traceState._internalState.set(key, value6);
      return traceState;
    }
    unset(key) {
      const traceState = this._clone();
      traceState._internalState.delete(key);
      return traceState;
    }
    get(key) {
      return this._internalState.get(key);
    }
    serialize() {
      return this._keys().reduce((agg, key) => {
        agg.push(key + LIST_MEMBER_KEY_VALUE_SPLITTER + this.get(key));
        return agg;
      }, []).join(LIST_MEMBERS_SEPARATOR);
    }
    _parse(rawTraceState) {
      if (rawTraceState.length > MAX_TRACE_STATE_LEN)
        return;
      this._internalState = rawTraceState.split(LIST_MEMBERS_SEPARATOR).reverse().reduce((agg, part) => {
        const listMember = part.trim();
        const i = listMember.indexOf(LIST_MEMBER_KEY_VALUE_SPLITTER);
        if (i !== -1) {
          const key = listMember.slice(0, i);
          const value6 = listMember.slice(i + 1, part.length);
          if ((0, tracestate_validators_1.validateKey)(key) && (0, tracestate_validators_1.validateValue)(value6)) {
            agg.set(key, value6);
          } else {}
        }
        return agg;
      }, new Map);
      if (this._internalState.size > MAX_TRACE_STATE_ITEMS) {
        this._internalState = new Map(Array.from(this._internalState.entries()).reverse().slice(0, MAX_TRACE_STATE_ITEMS));
      }
    }
    _keys() {
      return Array.from(this._internalState.keys()).reverse();
    }
    _clone() {
      const traceState = new TraceStateImpl;
      traceState._internalState = new Map(this._internalState);
      return traceState;
    }
  }
  exports.TraceStateImpl = TraceStateImpl;
});

// node_modules/@opentelemetry/api/build/src/trace/internal/utils.js
var require_utils2 = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.createTraceState = undefined;
  var tracestate_impl_1 = require_tracestate_impl();
  function createTraceState(rawTraceState) {
    return new tracestate_impl_1.TraceStateImpl(rawTraceState);
  }
  exports.createTraceState = createTraceState;
});

// node_modules/@opentelemetry/api/build/src/context-api.js
var require_context_api = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.context = undefined;
  var context_1 = require_context2();
  exports.context = context_1.ContextAPI.getInstance();
});

// node_modules/@opentelemetry/api/build/src/diag-api.js
var require_diag_api = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.diag = undefined;
  var diag_1 = require_diag();
  exports.diag = diag_1.DiagAPI.instance();
});

// node_modules/@opentelemetry/api/build/src/metrics/NoopMeterProvider.js
var require_NoopMeterProvider = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NOOP_METER_PROVIDER = exports.NoopMeterProvider = undefined;
  var NoopMeter_1 = require_NoopMeter();

  class NoopMeterProvider {
    getMeter(_name, _version2, _options) {
      return NoopMeter_1.NOOP_METER;
    }
  }
  exports.NoopMeterProvider = NoopMeterProvider;
  exports.NOOP_METER_PROVIDER = new NoopMeterProvider;
});

// node_modules/@opentelemetry/api/build/src/api/metrics.js
var require_metrics = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MetricsAPI = undefined;
  var NoopMeterProvider_1 = require_NoopMeterProvider();
  var global_utils_1 = require_global_utils();
  var diag_1 = require_diag();
  var API_NAME = "metrics";

  class MetricsAPI {
    constructor() {}
    static getInstance() {
      if (!this._instance) {
        this._instance = new MetricsAPI;
      }
      return this._instance;
    }
    setGlobalMeterProvider(provider) {
      return (0, global_utils_1.registerGlobal)(API_NAME, provider, diag_1.DiagAPI.instance());
    }
    getMeterProvider() {
      return (0, global_utils_1.getGlobal)(API_NAME) || NoopMeterProvider_1.NOOP_METER_PROVIDER;
    }
    getMeter(name, version, options) {
      return this.getMeterProvider().getMeter(name, version, options);
    }
    disable() {
      (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
    }
  }
  exports.MetricsAPI = MetricsAPI;
});

// node_modules/@opentelemetry/api/build/src/metrics-api.js
var require_metrics_api = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.metrics = undefined;
  var metrics_1 = require_metrics();
  exports.metrics = metrics_1.MetricsAPI.getInstance();
});

// node_modules/@opentelemetry/api/build/src/propagation/NoopTextMapPropagator.js
var require_NoopTextMapPropagator = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NoopTextMapPropagator = undefined;

  class NoopTextMapPropagator {
    inject(_context, _carrier) {}
    extract(context9, _carrier) {
      return context9;
    }
    fields() {
      return [];
    }
  }
  exports.NoopTextMapPropagator = NoopTextMapPropagator;
});

// node_modules/@opentelemetry/api/build/src/baggage/context-helpers.js
var require_context_helpers = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.deleteBaggage = exports.setBaggage = exports.getActiveBaggage = exports.getBaggage = undefined;
  var context_1 = require_context2();
  var context_2 = require_context();
  var BAGGAGE_KEY = (0, context_2.createContextKey)("OpenTelemetry Baggage Key");
  function getBaggage(context9) {
    return context9.getValue(BAGGAGE_KEY) || undefined;
  }
  exports.getBaggage = getBaggage;
  function getActiveBaggage() {
    return getBaggage(context_1.ContextAPI.getInstance().active());
  }
  exports.getActiveBaggage = getActiveBaggage;
  function setBaggage(context9, baggage) {
    return context9.setValue(BAGGAGE_KEY, baggage);
  }
  exports.setBaggage = setBaggage;
  function deleteBaggage(context9) {
    return context9.deleteValue(BAGGAGE_KEY);
  }
  exports.deleteBaggage = deleteBaggage;
});

// node_modules/@opentelemetry/api/build/src/api/propagation.js
var require_propagation = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.PropagationAPI = undefined;
  var global_utils_1 = require_global_utils();
  var NoopTextMapPropagator_1 = require_NoopTextMapPropagator();
  var TextMapPropagator_1 = require_TextMapPropagator();
  var context_helpers_1 = require_context_helpers();
  var utils_1 = require_utils();
  var diag_1 = require_diag();
  var API_NAME = "propagation";
  var NOOP_TEXT_MAP_PROPAGATOR = new NoopTextMapPropagator_1.NoopTextMapPropagator;

  class PropagationAPI {
    constructor() {
      this.createBaggage = utils_1.createBaggage;
      this.getBaggage = context_helpers_1.getBaggage;
      this.getActiveBaggage = context_helpers_1.getActiveBaggage;
      this.setBaggage = context_helpers_1.setBaggage;
      this.deleteBaggage = context_helpers_1.deleteBaggage;
    }
    static getInstance() {
      if (!this._instance) {
        this._instance = new PropagationAPI;
      }
      return this._instance;
    }
    setGlobalPropagator(propagator) {
      return (0, global_utils_1.registerGlobal)(API_NAME, propagator, diag_1.DiagAPI.instance());
    }
    inject(context9, carrier, setter = TextMapPropagator_1.defaultTextMapSetter) {
      return this._getGlobalPropagator().inject(context9, carrier, setter);
    }
    extract(context9, carrier, getter = TextMapPropagator_1.defaultTextMapGetter) {
      return this._getGlobalPropagator().extract(context9, carrier, getter);
    }
    fields() {
      return this._getGlobalPropagator().fields();
    }
    disable() {
      (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
    }
    _getGlobalPropagator() {
      return (0, global_utils_1.getGlobal)(API_NAME) || NOOP_TEXT_MAP_PROPAGATOR;
    }
  }
  exports.PropagationAPI = PropagationAPI;
});

// node_modules/@opentelemetry/api/build/src/propagation-api.js
var require_propagation_api = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.propagation = undefined;
  var propagation_1 = require_propagation();
  exports.propagation = propagation_1.PropagationAPI.getInstance();
});

// node_modules/@opentelemetry/api/build/src/api/trace.js
var require_trace = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.TraceAPI = undefined;
  var global_utils_1 = require_global_utils();
  var ProxyTracerProvider_1 = require_ProxyTracerProvider();
  var spancontext_utils_1 = require_spancontext_utils();
  var context_utils_1 = require_context_utils();
  var diag_1 = require_diag();
  var API_NAME = "trace";

  class TraceAPI {
    constructor() {
      this._proxyTracerProvider = new ProxyTracerProvider_1.ProxyTracerProvider;
      this.wrapSpanContext = spancontext_utils_1.wrapSpanContext;
      this.isSpanContextValid = spancontext_utils_1.isSpanContextValid;
      this.deleteSpan = context_utils_1.deleteSpan;
      this.getSpan = context_utils_1.getSpan;
      this.getActiveSpan = context_utils_1.getActiveSpan;
      this.getSpanContext = context_utils_1.getSpanContext;
      this.setSpan = context_utils_1.setSpan;
      this.setSpanContext = context_utils_1.setSpanContext;
    }
    static getInstance() {
      if (!this._instance) {
        this._instance = new TraceAPI;
      }
      return this._instance;
    }
    setGlobalTracerProvider(provider) {
      const success = (0, global_utils_1.registerGlobal)(API_NAME, this._proxyTracerProvider, diag_1.DiagAPI.instance());
      if (success) {
        this._proxyTracerProvider.setDelegate(provider);
      }
      return success;
    }
    getTracerProvider() {
      return (0, global_utils_1.getGlobal)(API_NAME) || this._proxyTracerProvider;
    }
    getTracer(name, version) {
      return this.getTracerProvider().getTracer(name, version);
    }
    disable() {
      (0, global_utils_1.unregisterGlobal)(API_NAME, diag_1.DiagAPI.instance());
      this._proxyTracerProvider = new ProxyTracerProvider_1.ProxyTracerProvider;
    }
  }
  exports.TraceAPI = TraceAPI;
});

// node_modules/@opentelemetry/api/build/src/trace-api.js
var require_trace_api = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.trace = undefined;
  var trace_1 = require_trace();
  exports.trace = trace_1.TraceAPI.getInstance();
});

// node_modules/@opentelemetry/api/build/src/index.js
var require_src = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.trace = exports.propagation = exports.metrics = exports.diag = exports.context = exports.INVALID_SPAN_CONTEXT = exports.INVALID_TRACEID = exports.INVALID_SPANID = exports.isValidSpanId = exports.isValidTraceId = exports.isSpanContextValid = exports.createTraceState = exports.TraceFlags = exports.SpanStatusCode = exports.SpanKind = exports.SamplingDecision = exports.ProxyTracerProvider = exports.ProxyTracer = exports.defaultTextMapSetter = exports.defaultTextMapGetter = exports.ValueType = exports.createNoopMeter = exports.DiagLogLevel = exports.DiagConsoleLogger = exports.ROOT_CONTEXT = exports.createContextKey = exports.baggageEntryMetadataFromString = undefined;
  var utils_1 = require_utils();
  Object.defineProperty(exports, "baggageEntryMetadataFromString", { enumerable: true, get: function() {
    return utils_1.baggageEntryMetadataFromString;
  } });
  var context_1 = require_context();
  Object.defineProperty(exports, "createContextKey", { enumerable: true, get: function() {
    return context_1.createContextKey;
  } });
  Object.defineProperty(exports, "ROOT_CONTEXT", { enumerable: true, get: function() {
    return context_1.ROOT_CONTEXT;
  } });
  var consoleLogger_1 = require_consoleLogger();
  Object.defineProperty(exports, "DiagConsoleLogger", { enumerable: true, get: function() {
    return consoleLogger_1.DiagConsoleLogger;
  } });
  var types_1 = require_types();
  Object.defineProperty(exports, "DiagLogLevel", { enumerable: true, get: function() {
    return types_1.DiagLogLevel;
  } });
  var NoopMeter_1 = require_NoopMeter();
  Object.defineProperty(exports, "createNoopMeter", { enumerable: true, get: function() {
    return NoopMeter_1.createNoopMeter;
  } });
  var Metric_1 = require_Metric();
  Object.defineProperty(exports, "ValueType", { enumerable: true, get: function() {
    return Metric_1.ValueType;
  } });
  var TextMapPropagator_1 = require_TextMapPropagator();
  Object.defineProperty(exports, "defaultTextMapGetter", { enumerable: true, get: function() {
    return TextMapPropagator_1.defaultTextMapGetter;
  } });
  Object.defineProperty(exports, "defaultTextMapSetter", { enumerable: true, get: function() {
    return TextMapPropagator_1.defaultTextMapSetter;
  } });
  var ProxyTracer_1 = require_ProxyTracer();
  Object.defineProperty(exports, "ProxyTracer", { enumerable: true, get: function() {
    return ProxyTracer_1.ProxyTracer;
  } });
  var ProxyTracerProvider_1 = require_ProxyTracerProvider();
  Object.defineProperty(exports, "ProxyTracerProvider", { enumerable: true, get: function() {
    return ProxyTracerProvider_1.ProxyTracerProvider;
  } });
  var SamplingResult_1 = require_SamplingResult();
  Object.defineProperty(exports, "SamplingDecision", { enumerable: true, get: function() {
    return SamplingResult_1.SamplingDecision;
  } });
  var span_kind_1 = require_span_kind();
  Object.defineProperty(exports, "SpanKind", { enumerable: true, get: function() {
    return span_kind_1.SpanKind;
  } });
  var status_1 = require_status();
  Object.defineProperty(exports, "SpanStatusCode", { enumerable: true, get: function() {
    return status_1.SpanStatusCode;
  } });
  var trace_flags_1 = require_trace_flags();
  Object.defineProperty(exports, "TraceFlags", { enumerable: true, get: function() {
    return trace_flags_1.TraceFlags;
  } });
  var utils_2 = require_utils2();
  Object.defineProperty(exports, "createTraceState", { enumerable: true, get: function() {
    return utils_2.createTraceState;
  } });
  var spancontext_utils_1 = require_spancontext_utils();
  Object.defineProperty(exports, "isSpanContextValid", { enumerable: true, get: function() {
    return spancontext_utils_1.isSpanContextValid;
  } });
  Object.defineProperty(exports, "isValidTraceId", { enumerable: true, get: function() {
    return spancontext_utils_1.isValidTraceId;
  } });
  Object.defineProperty(exports, "isValidSpanId", { enumerable: true, get: function() {
    return spancontext_utils_1.isValidSpanId;
  } });
  var invalid_span_constants_1 = require_invalid_span_constants();
  Object.defineProperty(exports, "INVALID_SPANID", { enumerable: true, get: function() {
    return invalid_span_constants_1.INVALID_SPANID;
  } });
  Object.defineProperty(exports, "INVALID_TRACEID", { enumerable: true, get: function() {
    return invalid_span_constants_1.INVALID_TRACEID;
  } });
  Object.defineProperty(exports, "INVALID_SPAN_CONTEXT", { enumerable: true, get: function() {
    return invalid_span_constants_1.INVALID_SPAN_CONTEXT;
  } });
  var context_api_1 = require_context_api();
  Object.defineProperty(exports, "context", { enumerable: true, get: function() {
    return context_api_1.context;
  } });
  var diag_api_1 = require_diag_api();
  Object.defineProperty(exports, "diag", { enumerable: true, get: function() {
    return diag_api_1.diag;
  } });
  var metrics_api_1 = require_metrics_api();
  Object.defineProperty(exports, "metrics", { enumerable: true, get: function() {
    return metrics_api_1.metrics;
  } });
  var propagation_api_1 = require_propagation_api();
  Object.defineProperty(exports, "propagation", { enumerable: true, get: function() {
    return propagation_api_1.propagation;
  } });
  var trace_api_1 = require_trace_api();
  Object.defineProperty(exports, "trace", { enumerable: true, get: function() {
    return trace_api_1.trace;
  } });
  exports.default = {
    context: context_api_1.context,
    diag: diag_api_1.diag,
    metrics: metrics_api_1.metrics,
    propagation: propagation_api_1.propagation,
    trace: trace_api_1.trace
  };
});

// node_modules/prom-client/lib/util.js
var require_util = __commonJS((exports) => {
  exports.getValueAsString = function getValueString(value6) {
    if (Number.isNaN(value6)) {
      return "Nan";
    } else if (!Number.isFinite(value6)) {
      if (value6 < 0) {
        return "-Inf";
      } else {
        return "+Inf";
      }
    } else {
      return `${value6}`;
    }
  };
  exports.removeLabels = function removeLabels(hashMap3, labels, sortedLabelNames) {
    const hash2 = hashObject(labels, sortedLabelNames);
    delete hashMap3[hash2];
  };
  exports.setValue = function setValue(hashMap3, value6, labels) {
    const hash2 = hashObject(labels);
    hashMap3[hash2] = {
      value: typeof value6 === "number" ? value6 : 0,
      labels: labels || {}
    };
    return hashMap3;
  };
  exports.setValueDelta = function setValueDelta(hashMap3, deltaValue, labels, hash2 = "") {
    const value6 = typeof deltaValue === "number" ? deltaValue : 0;
    if (hashMap3[hash2]) {
      hashMap3[hash2].value += value6;
    } else {
      hashMap3[hash2] = { value: value6, labels };
    }
    return hashMap3;
  };
  exports.getLabels = function(labelNames, args2) {
    if (typeof args2[0] === "object") {
      return args2[0];
    }
    if (labelNames.length !== args2.length) {
      throw new Error(`Invalid number of arguments (${args2.length}): "${args2.join(", ")}" for label names (${labelNames.length}): "${labelNames.join(", ")}".`);
    }
    const acc = {};
    for (let i = 0;i < labelNames.length; i++) {
      acc[labelNames[i]] = args2[i];
    }
    return acc;
  };
  function fastHashObject(keys9, labels) {
    if (keys9.length === 0) {
      return "";
    }
    let hash2 = "";
    for (let i = 0;i < keys9.length; i++) {
      const key = keys9[i];
      const value6 = labels[key];
      if (value6 === undefined)
        continue;
      hash2 += `${key}:${value6},`;
    }
    return hash2;
  }
  function hashObject(labels, labelNames) {
    if (labelNames) {
      return fastHashObject(labelNames, labels);
    }
    const keys9 = Object.keys(labels);
    if (keys9.length > 1) {
      keys9.sort();
    }
    return fastHashObject(keys9, labels);
  }
  exports.hashObject = hashObject;
  exports.isObject = function isObject(obj) {
    return obj !== null && typeof obj === "object";
  };
  exports.nowTimestamp = function nowTimestamp() {
    return Date.now() / 1000;
  };

  class Grouper extends Map {
    add(key, value6) {
      if (this.has(key)) {
        this.get(key).push(value6);
      } else {
        this.set(key, [value6]);
      }
    }
  }
  exports.Grouper = Grouper;
});

// node_modules/prom-client/lib/registry.js
var require_registry = __commonJS((exports, module) => {
  var { getValueAsString } = require_util();

  class Registry {
    static get PROMETHEUS_CONTENT_TYPE() {
      return "text/plain; version=0.0.4; charset=utf-8";
    }
    static get OPENMETRICS_CONTENT_TYPE() {
      return "application/openmetrics-text; version=1.0.0; charset=utf-8";
    }
    constructor(regContentType = Registry.PROMETHEUS_CONTENT_TYPE) {
      this._metrics = {};
      this._collectors = [];
      this._defaultLabels = {};
      if (regContentType !== Registry.PROMETHEUS_CONTENT_TYPE && regContentType !== Registry.OPENMETRICS_CONTENT_TYPE) {
        throw new TypeError(`Content type ${regContentType} is unsupported`);
      }
      this._contentType = regContentType;
    }
    getMetricsAsArray() {
      return Object.values(this._metrics);
    }
    async getMetricsAsString(metrics) {
      const metric = typeof metrics.getForPromString === "function" ? await metrics.getForPromString() : await metrics.get();
      const name = escapeString(metric.name);
      const help = `# HELP ${name} ${escapeString(metric.help)}`;
      const type2 = `# TYPE ${name} ${metric.type}`;
      const values7 = [help, type2];
      const defaultLabels = Object.keys(this._defaultLabels).length > 0 ? this._defaultLabels : null;
      const isOpenMetrics = this.contentType === Registry.OPENMETRICS_CONTENT_TYPE;
      for (const val of metric.values || []) {
        let { metricName = name, labels = {} } = val;
        const { sharedLabels = {} } = val;
        if (isOpenMetrics && metric.type === "counter") {
          metricName = `${metricName}_total`;
        }
        if (defaultLabels) {
          labels = { ...labels, ...defaultLabels, ...labels };
        }
        const formattedLabels = formatLabels(labels, sharedLabels);
        const flattenedShared = flattenSharedLabels(sharedLabels);
        const labelParts = [...formattedLabels, flattenedShared].filter(Boolean);
        const labelsString = labelParts.length ? `{${labelParts.join(",")}}` : "";
        let fullMetricLine = `${metricName}${labelsString} ${getValueAsString(val.value)}`;
        const { exemplar } = val;
        if (exemplar && isOpenMetrics) {
          const formattedExemplars = formatLabels(exemplar.labelSet);
          fullMetricLine += ` # {${formattedExemplars.join(",")}} ${getValueAsString(exemplar.value)} ${exemplar.timestamp}`;
        }
        values7.push(fullMetricLine);
      }
      return values7.join(`
`);
    }
    async metrics() {
      const isOpenMetrics = this.contentType === Registry.OPENMETRICS_CONTENT_TYPE;
      const promises = this.getMetricsAsArray().map((metric) => {
        if (isOpenMetrics && metric.type === "counter") {
          metric.name = standardizeCounterName(metric.name);
        }
        return this.getMetricsAsString(metric);
      });
      const resolves = await Promise.all(promises);
      return isOpenMetrics ? `${resolves.join(`
`)}
# EOF
` : `${resolves.join(`

`)}
`;
    }
    registerMetric(metric) {
      if (this._metrics[metric.name] && this._metrics[metric.name] !== metric) {
        throw new Error(`A metric with the name ${metric.name} has already been registered.`);
      }
      this._metrics[metric.name] = metric;
    }
    clear() {
      this._metrics = {};
      this._defaultLabels = {};
    }
    async getMetricsAsJSON() {
      const metrics = [];
      const defaultLabelNames = Object.keys(this._defaultLabels);
      const promises = [];
      for (const metric of this.getMetricsAsArray()) {
        promises.push(metric.get());
      }
      const resolves = await Promise.all(promises);
      for (const item of resolves) {
        if (item.values && defaultLabelNames.length > 0) {
          for (const val of item.values) {
            val.labels = Object.assign({}, val.labels);
            for (const labelName of defaultLabelNames) {
              val.labels[labelName] = val.labels[labelName] || this._defaultLabels[labelName];
            }
          }
        }
        metrics.push(item);
      }
      return metrics;
    }
    removeSingleMetric(name) {
      delete this._metrics[name];
    }
    getSingleMetricAsString(name) {
      return this.getMetricsAsString(this._metrics[name]);
    }
    getSingleMetric(name) {
      return this._metrics[name];
    }
    setDefaultLabels(labels) {
      this._defaultLabels = labels;
    }
    resetMetrics() {
      for (const metric in this._metrics) {
        this._metrics[metric].reset();
      }
    }
    get contentType() {
      return this._contentType;
    }
    setContentType(metricsContentType) {
      if (metricsContentType === Registry.OPENMETRICS_CONTENT_TYPE || metricsContentType === Registry.PROMETHEUS_CONTENT_TYPE) {
        this._contentType = metricsContentType;
      } else {
        throw new Error(`Content type ${metricsContentType} is unsupported`);
      }
    }
    static merge(registers) {
      const regType = registers[0].contentType;
      for (const reg of registers) {
        if (reg.contentType !== regType) {
          throw new Error("Registers can only be merged if they have the same content type");
        }
      }
      const mergedRegistry = new Registry(regType);
      const metricsToMerge = registers.reduce((acc, reg) => acc.concat(reg.getMetricsAsArray()), []);
      metricsToMerge.forEach(mergedRegistry.registerMetric, mergedRegistry);
      return mergedRegistry;
    }
  }
  function formatLabels(labels, exclude3) {
    const { hasOwnProperty } = Object.prototype;
    const formatted = [];
    for (const [name, value6] of Object.entries(labels)) {
      if (!exclude3 || !hasOwnProperty.call(exclude3, name)) {
        formatted.push(`${name}="${escapeLabelValue(value6)}"`);
      }
    }
    return formatted;
  }
  var sharedLabelCache = new WeakMap;
  function flattenSharedLabels(labels) {
    const cached4 = sharedLabelCache.get(labels);
    if (cached4) {
      return cached4;
    }
    const formattedLabels = formatLabels(labels);
    const flattened = formattedLabels.join(",");
    sharedLabelCache.set(labels, flattened);
    return flattened;
  }
  function escapeLabelValue(str) {
    if (typeof str !== "string") {
      return str;
    }
    return escapeString(str).replace(/"/g, "\\\"");
  }
  function escapeString(str) {
    return str.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
  }
  function standardizeCounterName(name) {
    return name.replace(/_total$/, "");
  }
  module.exports = Registry;
  module.exports.globalRegistry = new Registry;
});

// node_modules/prom-client/lib/validation.js
var require_validation = __commonJS((exports) => {
  var util = __require("util");
  var metricRegexp = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
  var labelRegexp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  exports.validateMetricName = function(name) {
    return metricRegexp.test(name);
  };
  exports.validateLabelName = function(names = []) {
    return names.every((name) => labelRegexp.test(name));
  };
  exports.validateLabel = function validateLabel(savedLabels, labels) {
    for (const label in labels) {
      if (!savedLabels.includes(label)) {
        throw new Error(`Added label "${label}" is not included in initial labelset: ${util.inspect(savedLabels)}`);
      }
    }
  };
});

// node_modules/prom-client/lib/metric.js
var require_metric = __commonJS((exports, module) => {
  var Registry = require_registry();
  var { isObject: isObject2 } = require_util();
  var { validateMetricName, validateLabelName } = require_validation();

  class Metric {
    constructor(config2, defaults = {}) {
      if (!isObject2(config2)) {
        throw new TypeError("constructor expected a config object");
      }
      Object.assign(this, {
        labelNames: [],
        registers: [Registry.globalRegistry],
        aggregator: "sum",
        enableExemplars: false
      }, defaults, config2);
      if (!this.registers) {
        this.registers = [Registry.globalRegistry];
      }
      if (!this.help) {
        throw new Error("Missing mandatory help parameter");
      }
      if (!this.name) {
        throw new Error("Missing mandatory name parameter");
      }
      if (!validateMetricName(this.name)) {
        throw new Error("Invalid metric name");
      }
      if (!validateLabelName(this.labelNames)) {
        throw new Error("Invalid label name");
      }
      if (this.collect && typeof this.collect !== "function") {
        throw new Error('Optional "collect" parameter must be a function');
      }
      if (this.labelNames) {
        this.sortedLabelNames = [...this.labelNames].sort();
      } else {
        this.sortedLabelNames = [];
      }
      this.reset();
      for (const register of this.registers) {
        if (this.enableExemplars && register.contentType === Registry.PROMETHEUS_CONTENT_TYPE) {
          throw new TypeError("Exemplars are supported only on OpenMetrics registries");
        }
        register.registerMetric(this);
      }
    }
    reset() {}
  }
  module.exports = { Metric };
});

// node_modules/prom-client/lib/exemplar.js
var require_exemplar = __commonJS((exports, module) => {
  class Exemplar {
    constructor(labelSet = {}, value6 = null) {
      this.labelSet = labelSet;
      this.value = value6;
    }
    validateExemplarLabelSet(labelSet) {
      let res = "";
      for (const [labelName, labelValue] of Object.entries(labelSet)) {
        res += `${labelName}${labelValue}`;
      }
      if (res.length > 128) {
        throw new RangeError("Label set size must be smaller than 128 UTF-8 chars");
      }
    }
  }
  module.exports = Exemplar;
});

// node_modules/prom-client/lib/counter.js
var require_counter = __commonJS((exports, module) => {
  var util = __require("util");
  var {
    hashObject,
    isObject: isObject2,
    getLabels,
    removeLabels,
    nowTimestamp
  } = require_util();
  var { validateLabel } = require_validation();
  var { Metric } = require_metric();
  var Exemplar = require_exemplar();

  class Counter extends Metric {
    constructor(config2) {
      super(config2);
      this.type = "counter";
      this.defaultLabels = {};
      this.defaultValue = 1;
      this.defaultExemplarLabelSet = {};
      if (config2.enableExemplars) {
        this.enableExemplars = true;
        this.inc = this.incWithExemplar;
      } else {
        this.inc = this.incWithoutExemplar;
      }
    }
    incWithoutExemplar(labels, value6) {
      let hash2 = "";
      if (isObject2(labels)) {
        hash2 = hashObject(labels, this.sortedLabelNames);
        validateLabel(this.labelNames, labels);
      } else {
        value6 = labels;
        labels = {};
      }
      if (value6 && !Number.isFinite(value6)) {
        throw new TypeError(`Value is not a valid number: ${util.format(value6)}`);
      }
      if (value6 < 0) {
        throw new Error("It is not possible to decrease a counter");
      }
      if (value6 === null || value6 === undefined)
        value6 = 1;
      setValue(this.hashMap, value6, labels, hash2);
      return { labelHash: hash2 };
    }
    incWithExemplar({
      labels = this.defaultLabels,
      value: value6 = this.defaultValue,
      exemplarLabels = this.defaultExemplarLabelSet
    } = {}) {
      const res = this.incWithoutExemplar(labels, value6);
      this.updateExemplar(exemplarLabels, value6, res.labelHash);
    }
    updateExemplar(exemplarLabels, value6, hash2) {
      if (exemplarLabels === this.defaultExemplarLabelSet)
        return;
      if (!isObject2(this.hashMap[hash2].exemplar)) {
        this.hashMap[hash2].exemplar = new Exemplar;
      }
      this.hashMap[hash2].exemplar.validateExemplarLabelSet(exemplarLabels);
      this.hashMap[hash2].exemplar.labelSet = exemplarLabels;
      this.hashMap[hash2].exemplar.value = value6 ? value6 : 1;
      this.hashMap[hash2].exemplar.timestamp = nowTimestamp();
    }
    reset() {
      this.hashMap = {};
      if (this.labelNames.length === 0) {
        setValue(this.hashMap, 0);
      }
    }
    async get() {
      if (this.collect) {
        const v = this.collect();
        if (v instanceof Promise)
          await v;
      }
      return {
        help: this.help,
        name: this.name,
        type: this.type,
        values: Object.values(this.hashMap),
        aggregator: this.aggregator
      };
    }
    labels(...args2) {
      const labels = getLabels(this.labelNames, args2) || {};
      return {
        inc: this.inc.bind(this, labels)
      };
    }
    remove(...args2) {
      const labels = getLabels(this.labelNames, args2) || {};
      validateLabel(this.labelNames, labels);
      return removeLabels.call(this, this.hashMap, labels, this.sortedLabelNames);
    }
  }
  function setValue(hashMap3, value6, labels = {}, hash2 = "") {
    if (hashMap3[hash2]) {
      hashMap3[hash2].value += value6;
    } else {
      hashMap3[hash2] = { value: value6, labels };
    }
    return hashMap3;
  }
  module.exports = Counter;
});

// node_modules/prom-client/lib/gauge.js
var require_gauge = __commonJS((exports, module) => {
  var util = __require("util");
  var {
    setValue,
    setValueDelta,
    getLabels,
    hashObject,
    isObject: isObject2,
    removeLabels
  } = require_util();
  var { validateLabel } = require_validation();
  var { Metric } = require_metric();

  class Gauge extends Metric {
    constructor(config2) {
      super(config2);
      this.type = "gauge";
    }
    set(labels, value6) {
      value6 = getValueArg(labels, value6);
      labels = getLabelArg(labels);
      set16(this, labels, value6);
    }
    reset() {
      this.hashMap = {};
      if (this.labelNames.length === 0) {
        setValue(this.hashMap, 0, {});
      }
    }
    inc(labels, value6) {
      value6 = getValueArg(labels, value6);
      labels = getLabelArg(labels);
      if (value6 === undefined)
        value6 = 1;
      setDelta(this, labels, value6);
    }
    dec(labels, value6) {
      value6 = getValueArg(labels, value6);
      labels = getLabelArg(labels);
      if (value6 === undefined)
        value6 = 1;
      setDelta(this, labels, -value6);
    }
    setToCurrentTime(labels) {
      const now2 = Date.now() / 1000;
      if (labels === undefined) {
        this.set(now2);
      } else {
        this.set(labels, now2);
      }
    }
    startTimer(labels) {
      const start5 = process.hrtime();
      return (endLabels) => {
        const delta = process.hrtime(start5);
        const value6 = delta[0] + delta[1] / 1e9;
        this.set(Object.assign({}, labels, endLabels), value6);
        return value6;
      };
    }
    async get() {
      if (this.collect) {
        const v = this.collect();
        if (v instanceof Promise)
          await v;
      }
      return {
        help: this.help,
        name: this.name,
        type: this.type,
        values: Object.values(this.hashMap),
        aggregator: this.aggregator
      };
    }
    _getValue(labels) {
      const hash2 = hashObject(labels || {}, this.sortedLabelNames);
      return this.hashMap[hash2] ? this.hashMap[hash2].value : 0;
    }
    labels(...args2) {
      const labels = getLabels(this.labelNames, args2);
      validateLabel(this.labelNames, labels);
      return {
        inc: this.inc.bind(this, labels),
        dec: this.dec.bind(this, labels),
        set: this.set.bind(this, labels),
        setToCurrentTime: this.setToCurrentTime.bind(this, labels),
        startTimer: this.startTimer.bind(this, labels)
      };
    }
    remove(...args2) {
      const labels = getLabels(this.labelNames, args2);
      validateLabel(this.labelNames, labels);
      removeLabels.call(this, this.hashMap, labels, this.sortedLabelNames);
    }
  }
  function set16(gauge6, labels, value6) {
    if (typeof value6 !== "number") {
      throw new TypeError(`Value is not a valid number: ${util.format(value6)}`);
    }
    validateLabel(gauge6.labelNames, labels);
    setValue(gauge6.hashMap, value6, labels);
  }
  function setDelta(gauge6, labels, delta) {
    if (typeof delta !== "number") {
      throw new TypeError(`Delta is not a valid number: ${util.format(delta)}`);
    }
    validateLabel(gauge6.labelNames, labels);
    const hash2 = hashObject(labels, gauge6.sortedLabelNames);
    setValueDelta(gauge6.hashMap, delta, labels, hash2);
  }
  function getLabelArg(labels) {
    return isObject2(labels) ? labels : {};
  }
  function getValueArg(labels, value6) {
    return isObject2(labels) ? value6 : labels;
  }
  module.exports = Gauge;
});

// node_modules/prom-client/lib/histogram.js
var require_histogram = __commonJS((exports, module) => {
  var util = __require("util");
  var {
    getLabels,
    hashObject,
    isObject: isObject2,
    removeLabels,
    nowTimestamp
  } = require_util();
  var { validateLabel } = require_validation();
  var { Metric } = require_metric();
  var Exemplar = require_exemplar();

  class Histogram extends Metric {
    constructor(config2) {
      super(config2, {
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
      });
      this.type = "histogram";
      this.defaultLabels = {};
      this.defaultExemplarLabelSet = {};
      this.enableExemplars = false;
      for (const label of this.labelNames) {
        if (label === "le") {
          throw new Error("le is a reserved label keyword");
        }
      }
      this.upperBounds = this.buckets;
      this.bucketValues = this.upperBounds.reduce((acc, upperBound) => {
        acc[upperBound] = 0;
        return acc;
      }, {});
      if (config2.enableExemplars) {
        this.enableExemplars = true;
        this.bucketExemplars = this.upperBounds.reduce((acc, upperBound) => {
          acc[upperBound] = null;
          return acc;
        }, {});
        Object.freeze(this.bucketExemplars);
        this.observe = this.observeWithExemplar;
      } else {
        this.observe = this.observeWithoutExemplar;
      }
      Object.freeze(this.bucketValues);
      Object.freeze(this.upperBounds);
      if (this.labelNames.length === 0) {
        this.hashMap = {
          [hashObject({})]: createBaseValues({}, this.bucketValues, this.bucketExemplars)
        };
      }
    }
    observeWithoutExemplar(labels, value6) {
      observe.call(this, labels === 0 ? 0 : labels || {})(value6);
    }
    observeWithExemplar({
      labels = this.defaultLabels,
      value: value6,
      exemplarLabels = this.defaultExemplarLabelSet
    } = {}) {
      observe.call(this, labels === 0 ? 0 : labels || {})(value6);
      this.updateExemplar(labels, value6, exemplarLabels);
    }
    updateExemplar(labels, value6, exemplarLabels) {
      if (Object.keys(exemplarLabels).length === 0)
        return;
      const hash2 = hashObject(labels, this.sortedLabelNames);
      const bound = findBound(this.upperBounds, value6);
      const { bucketExemplars } = this.hashMap[hash2];
      let exemplar = bucketExemplars[bound];
      if (!isObject2(exemplar)) {
        exemplar = new Exemplar;
        bucketExemplars[bound] = exemplar;
      }
      exemplar.validateExemplarLabelSet(exemplarLabels);
      exemplar.labelSet = exemplarLabels;
      exemplar.value = value6;
      exemplar.timestamp = nowTimestamp();
    }
    async get() {
      const data = await this.getForPromString();
      data.values = data.values.map(splayLabels);
      return data;
    }
    async getForPromString() {
      if (this.collect) {
        const v = this.collect();
        if (v instanceof Promise)
          await v;
      }
      const data = Object.values(this.hashMap);
      const values7 = data.map(extractBucketValuesForExport(this)).reduce(addSumAndCountForExport(this), []);
      return {
        name: this.name,
        help: this.help,
        type: this.type,
        values: values7,
        aggregator: this.aggregator
      };
    }
    reset() {
      this.hashMap = {};
    }
    zero(labels) {
      const hash2 = hashObject(labels, this.sortedLabelNames);
      this.hashMap[hash2] = createBaseValues(labels, this.bucketValues, this.bucketExemplars);
    }
    startTimer(labels, exemplarLabels) {
      return this.enableExemplars ? startTimerWithExemplar.call(this, labels, exemplarLabels)() : startTimer.call(this, labels)();
    }
    labels(...args2) {
      const labels = getLabels(this.labelNames, args2);
      validateLabel(this.labelNames, labels);
      return {
        observe: observe.call(this, labels),
        startTimer: startTimer.call(this, labels)
      };
    }
    remove(...args2) {
      const labels = getLabels(this.labelNames, args2);
      validateLabel(this.labelNames, labels);
      removeLabels.call(this, this.hashMap, labels, this.sortedLabelNames);
    }
  }
  function startTimer(startLabels) {
    return () => {
      const start5 = process.hrtime();
      return (endLabels) => {
        const delta = process.hrtime(start5);
        const value6 = delta[0] + delta[1] / 1e9;
        this.observe(Object.assign({}, startLabels, endLabels), value6);
        return value6;
      };
    };
  }
  function startTimerWithExemplar(startLabels, startExemplarLabels) {
    return () => {
      const start5 = process.hrtime();
      return (endLabels, endExemplarLabels) => {
        const delta = process.hrtime(start5);
        const value6 = delta[0] + delta[1] / 1e9;
        this.observe({
          labels: Object.assign({}, startLabels, endLabels),
          value: value6,
          exemplarLabels: Object.assign({}, startExemplarLabels, endExemplarLabels)
        });
        return value6;
      };
    };
  }
  function setValuePair(labels, value6, metricName, exemplar, sharedLabels = {}) {
    return {
      labels,
      sharedLabels,
      value: value6,
      metricName,
      exemplar
    };
  }
  function findBound(upperBounds, value6) {
    for (let i = 0;i < upperBounds.length; i++) {
      const bound = upperBounds[i];
      if (value6 <= bound) {
        return bound;
      }
    }
    return -1;
  }
  function observe(labels) {
    return (value6) => {
      const labelValuePair = convertLabelsAndValues(labels, value6);
      validateLabel(this.labelNames, labelValuePair.labels);
      if (!Number.isFinite(labelValuePair.value)) {
        throw new TypeError(`Value is not a valid number: ${util.format(labelValuePair.value)}`);
      }
      const hash2 = hashObject(labelValuePair.labels, this.sortedLabelNames);
      let valueFromMap = this.hashMap[hash2];
      if (!valueFromMap) {
        valueFromMap = createBaseValues(labelValuePair.labels, this.bucketValues, this.bucketExemplars);
      }
      const b = findBound(this.upperBounds, labelValuePair.value);
      valueFromMap.sum += labelValuePair.value;
      valueFromMap.count += 1;
      if (Object.prototype.hasOwnProperty.call(valueFromMap.bucketValues, b)) {
        valueFromMap.bucketValues[b] += 1;
      }
      this.hashMap[hash2] = valueFromMap;
    };
  }
  function createBaseValues(labels, bucketValues, bucketExemplars) {
    const result = {
      labels,
      bucketValues: { ...bucketValues },
      sum: 0,
      count: 0
    };
    if (bucketExemplars) {
      result.bucketExemplars = { ...bucketExemplars };
    }
    return result;
  }
  function convertLabelsAndValues(labels, value6) {
    return isObject2(labels) ? {
      labels,
      value: value6
    } : {
      value: labels,
      labels: {}
    };
  }
  function extractBucketValuesForExport(histogram6) {
    const name = `${histogram6.name}_bucket`;
    return (bucketData) => {
      let acc = 0;
      const buckets = histogram6.upperBounds.map((upperBound) => {
        acc += bucketData.bucketValues[upperBound];
        return setValuePair({ le: upperBound }, acc, name, bucketData.bucketExemplars ? bucketData.bucketExemplars[upperBound] : null, bucketData.labels);
      });
      return { buckets, data: bucketData };
    };
  }
  function addSumAndCountForExport(histogram6) {
    return (acc, d) => {
      acc.push(...d.buckets);
      const infLabel = { le: "+Inf" };
      acc.push(setValuePair(infLabel, d.data.count, `${histogram6.name}_bucket`, d.data.bucketExemplars ? d.data.bucketExemplars["-1"] : null, d.data.labels), setValuePair({}, d.data.sum, `${histogram6.name}_sum`, undefined, d.data.labels), setValuePair({}, d.data.count, `${histogram6.name}_count`, undefined, d.data.labels));
      return acc;
    };
  }
  function splayLabels(bucket) {
    const { sharedLabels, labels, ...newBucket } = bucket;
    for (const label of Object.keys(sharedLabels)) {
      labels[label] = sharedLabels[label];
    }
    newBucket.labels = labels;
    return newBucket;
  }
  module.exports = Histogram;
});

// node_modules/bintrees/lib/treebase.js
var require_treebase = __commonJS((exports, module) => {
  function TreeBase() {}
  TreeBase.prototype.clear = function() {
    this._root = null;
    this.size = 0;
  };
  TreeBase.prototype.find = function(data) {
    var res = this._root;
    while (res !== null) {
      var c = this._comparator(data, res.data);
      if (c === 0) {
        return res.data;
      } else {
        res = res.get_child(c > 0);
      }
    }
    return null;
  };
  TreeBase.prototype.findIter = function(data) {
    var res = this._root;
    var iter = this.iterator();
    while (res !== null) {
      var c = this._comparator(data, res.data);
      if (c === 0) {
        iter._cursor = res;
        return iter;
      } else {
        iter._ancestors.push(res);
        res = res.get_child(c > 0);
      }
    }
    return null;
  };
  TreeBase.prototype.lowerBound = function(item) {
    var cur = this._root;
    var iter = this.iterator();
    var cmp = this._comparator;
    while (cur !== null) {
      var c = cmp(item, cur.data);
      if (c === 0) {
        iter._cursor = cur;
        return iter;
      }
      iter._ancestors.push(cur);
      cur = cur.get_child(c > 0);
    }
    for (var i = iter._ancestors.length - 1;i >= 0; --i) {
      cur = iter._ancestors[i];
      if (cmp(item, cur.data) < 0) {
        iter._cursor = cur;
        iter._ancestors.length = i;
        return iter;
      }
    }
    iter._ancestors.length = 0;
    return iter;
  };
  TreeBase.prototype.upperBound = function(item) {
    var iter = this.lowerBound(item);
    var cmp = this._comparator;
    while (iter.data() !== null && cmp(iter.data(), item) === 0) {
      iter.next();
    }
    return iter;
  };
  TreeBase.prototype.min = function() {
    var res = this._root;
    if (res === null) {
      return null;
    }
    while (res.left !== null) {
      res = res.left;
    }
    return res.data;
  };
  TreeBase.prototype.max = function() {
    var res = this._root;
    if (res === null) {
      return null;
    }
    while (res.right !== null) {
      res = res.right;
    }
    return res.data;
  };
  TreeBase.prototype.iterator = function() {
    return new Iterator(this);
  };
  TreeBase.prototype.each = function(cb) {
    var it = this.iterator(), data;
    while ((data = it.next()) !== null) {
      if (cb(data) === false) {
        return;
      }
    }
  };
  TreeBase.prototype.reach = function(cb) {
    var it = this.iterator(), data;
    while ((data = it.prev()) !== null) {
      if (cb(data) === false) {
        return;
      }
    }
  };
  function Iterator(tree) {
    this._tree = tree;
    this._ancestors = [];
    this._cursor = null;
  }
  Iterator.prototype.data = function() {
    return this._cursor !== null ? this._cursor.data : null;
  };
  Iterator.prototype.next = function() {
    if (this._cursor === null) {
      var root = this._tree._root;
      if (root !== null) {
        this._minNode(root);
      }
    } else {
      if (this._cursor.right === null) {
        var save;
        do {
          save = this._cursor;
          if (this._ancestors.length) {
            this._cursor = this._ancestors.pop();
          } else {
            this._cursor = null;
            break;
          }
        } while (this._cursor.right === save);
      } else {
        this._ancestors.push(this._cursor);
        this._minNode(this._cursor.right);
      }
    }
    return this._cursor !== null ? this._cursor.data : null;
  };
  Iterator.prototype.prev = function() {
    if (this._cursor === null) {
      var root = this._tree._root;
      if (root !== null) {
        this._maxNode(root);
      }
    } else {
      if (this._cursor.left === null) {
        var save;
        do {
          save = this._cursor;
          if (this._ancestors.length) {
            this._cursor = this._ancestors.pop();
          } else {
            this._cursor = null;
            break;
          }
        } while (this._cursor.left === save);
      } else {
        this._ancestors.push(this._cursor);
        this._maxNode(this._cursor.left);
      }
    }
    return this._cursor !== null ? this._cursor.data : null;
  };
  Iterator.prototype._minNode = function(start5) {
    while (start5.left !== null) {
      this._ancestors.push(start5);
      start5 = start5.left;
    }
    this._cursor = start5;
  };
  Iterator.prototype._maxNode = function(start5) {
    while (start5.right !== null) {
      this._ancestors.push(start5);
      start5 = start5.right;
    }
    this._cursor = start5;
  };
  module.exports = TreeBase;
});

// node_modules/bintrees/lib/rbtree.js
var require_rbtree = __commonJS((exports, module) => {
  var TreeBase = require_treebase();
  function Node(data) {
    this.data = data;
    this.left = null;
    this.right = null;
    this.red = true;
  }
  Node.prototype.get_child = function(dir2) {
    return dir2 ? this.right : this.left;
  };
  Node.prototype.set_child = function(dir2, val) {
    if (dir2) {
      this.right = val;
    } else {
      this.left = val;
    }
  };
  function RBTree(comparator) {
    this._root = null;
    this._comparator = comparator;
    this.size = 0;
  }
  RBTree.prototype = new TreeBase;
  RBTree.prototype.insert = function(data) {
    var ret2 = false;
    if (this._root === null) {
      this._root = new Node(data);
      ret2 = true;
      this.size++;
    } else {
      var head8 = new Node(undefined);
      var dir2 = 0;
      var last6 = 0;
      var gp = null;
      var ggp = head8;
      var p = null;
      var node = this._root;
      ggp.right = this._root;
      while (true) {
        if (node === null) {
          node = new Node(data);
          p.set_child(dir2, node);
          ret2 = true;
          this.size++;
        } else if (is_red(node.left) && is_red(node.right)) {
          node.red = true;
          node.left.red = false;
          node.right.red = false;
        }
        if (is_red(node) && is_red(p)) {
          var dir22 = ggp.right === gp;
          if (node === p.get_child(last6)) {
            ggp.set_child(dir22, single_rotate(gp, !last6));
          } else {
            ggp.set_child(dir22, double_rotate(gp, !last6));
          }
        }
        var cmp = this._comparator(node.data, data);
        if (cmp === 0) {
          break;
        }
        last6 = dir2;
        dir2 = cmp < 0;
        if (gp !== null) {
          ggp = gp;
        }
        gp = p;
        p = node;
        node = node.get_child(dir2);
      }
      this._root = head8.right;
    }
    this._root.red = false;
    return ret2;
  };
  RBTree.prototype.remove = function(data) {
    if (this._root === null) {
      return false;
    }
    var head8 = new Node(undefined);
    var node = head8;
    node.right = this._root;
    var p = null;
    var gp = null;
    var found = null;
    var dir2 = 1;
    while (node.get_child(dir2) !== null) {
      var last6 = dir2;
      gp = p;
      p = node;
      node = node.get_child(dir2);
      var cmp = this._comparator(data, node.data);
      dir2 = cmp > 0;
      if (cmp === 0) {
        found = node;
      }
      if (!is_red(node) && !is_red(node.get_child(dir2))) {
        if (is_red(node.get_child(!dir2))) {
          var sr = single_rotate(node, dir2);
          p.set_child(last6, sr);
          p = sr;
        } else if (!is_red(node.get_child(!dir2))) {
          var sibling = p.get_child(!last6);
          if (sibling !== null) {
            if (!is_red(sibling.get_child(!last6)) && !is_red(sibling.get_child(last6))) {
              p.red = false;
              sibling.red = true;
              node.red = true;
            } else {
              var dir22 = gp.right === p;
              if (is_red(sibling.get_child(last6))) {
                gp.set_child(dir22, double_rotate(p, last6));
              } else if (is_red(sibling.get_child(!last6))) {
                gp.set_child(dir22, single_rotate(p, last6));
              }
              var gpc = gp.get_child(dir22);
              gpc.red = true;
              node.red = true;
              gpc.left.red = false;
              gpc.right.red = false;
            }
          }
        }
      }
    }
    if (found !== null) {
      found.data = node.data;
      p.set_child(p.right === node, node.get_child(node.left === null));
      this.size--;
    }
    this._root = head8.right;
    if (this._root !== null) {
      this._root.red = false;
    }
    return found !== null;
  };
  function is_red(node) {
    return node !== null && node.red;
  }
  function single_rotate(root, dir2) {
    var save = root.get_child(!dir2);
    root.set_child(!dir2, save.get_child(dir2));
    save.set_child(dir2, root);
    root.red = true;
    save.red = false;
    return save;
  }
  function double_rotate(root, dir2) {
    root.set_child(!dir2, single_rotate(root.get_child(!dir2), !dir2));
    return single_rotate(root, dir2);
  }
  module.exports = RBTree;
});

// node_modules/bintrees/lib/bintree.js
var require_bintree = __commonJS((exports, module) => {
  var TreeBase = require_treebase();
  function Node(data) {
    this.data = data;
    this.left = null;
    this.right = null;
  }
  Node.prototype.get_child = function(dir2) {
    return dir2 ? this.right : this.left;
  };
  Node.prototype.set_child = function(dir2, val) {
    if (dir2) {
      this.right = val;
    } else {
      this.left = val;
    }
  };
  function BinTree(comparator) {
    this._root = null;
    this._comparator = comparator;
    this.size = 0;
  }
  BinTree.prototype = new TreeBase;
  BinTree.prototype.insert = function(data) {
    if (this._root === null) {
      this._root = new Node(data);
      this.size++;
      return true;
    }
    var dir2 = 0;
    var p = null;
    var node = this._root;
    while (true) {
      if (node === null) {
        node = new Node(data);
        p.set_child(dir2, node);
        ret = true;
        this.size++;
        return true;
      }
      if (this._comparator(node.data, data) === 0) {
        return false;
      }
      dir2 = this._comparator(node.data, data) < 0;
      p = node;
      node = node.get_child(dir2);
    }
  };
  BinTree.prototype.remove = function(data) {
    if (this._root === null) {
      return false;
    }
    var head8 = new Node(undefined);
    var node = head8;
    node.right = this._root;
    var p = null;
    var found = null;
    var dir2 = 1;
    while (node.get_child(dir2) !== null) {
      p = node;
      node = node.get_child(dir2);
      var cmp = this._comparator(data, node.data);
      dir2 = cmp > 0;
      if (cmp === 0) {
        found = node;
      }
    }
    if (found !== null) {
      found.data = node.data;
      p.set_child(p.right === node, node.get_child(node.left === null));
      this._root = head8.right;
      this.size--;
      return true;
    } else {
      return false;
    }
  };
  module.exports = BinTree;
});

// node_modules/bintrees/index.js
var require_bintrees = __commonJS((exports, module) => {
  module.exports = {
    RBTree: require_rbtree(),
    BinTree: require_bintree()
  };
});

// node_modules/tdigest/tdigest.js
var require_tdigest = __commonJS((exports, module) => {
  var RBTree = require_bintrees().RBTree;
  function TDigest(delta, K, CX) {
    this.discrete = delta === false;
    this.delta = delta || 0.01;
    this.K = K === undefined ? 25 : K;
    this.CX = CX === undefined ? 1.1 : CX;
    this.centroids = new RBTree(compare_centroid_means);
    this.nreset = 0;
    this.reset();
  }
  TDigest.prototype.reset = function() {
    this.centroids.clear();
    this.n = 0;
    this.nreset += 1;
    this.last_cumulate = 0;
  };
  TDigest.prototype.size = function() {
    return this.centroids.size;
  };
  TDigest.prototype.toArray = function(everything) {
    var result = [];
    if (everything) {
      this._cumulate(true);
      this.centroids.each(function(c) {
        result.push(c);
      });
    } else {
      this.centroids.each(function(c) {
        result.push({ mean: c.mean, n: c.n });
      });
    }
    return result;
  };
  TDigest.prototype.summary = function() {
    var approx = this.discrete ? "exact " : "approximating ";
    var s = [
      approx + this.n + " samples using " + this.size() + " centroids",
      "min = " + this.percentile(0),
      "Q1  = " + this.percentile(0.25),
      "Q2  = " + this.percentile(0.5),
      "Q3  = " + this.percentile(0.75),
      "max = " + this.percentile(1)
    ];
    return s.join(`
`);
  };
  function compare_centroid_means(a, b) {
    return a.mean > b.mean ? 1 : a.mean < b.mean ? -1 : 0;
  }
  function compare_centroid_mean_cumns(a, b) {
    return a.mean_cumn - b.mean_cumn;
  }
  TDigest.prototype.push = function(x, n) {
    n = n || 1;
    x = Array.isArray(x) ? x : [x];
    for (var i = 0;i < x.length; i++) {
      this._digest(x[i], n);
    }
  };
  TDigest.prototype.push_centroid = function(c) {
    c = Array.isArray(c) ? c : [c];
    for (var i = 0;i < c.length; i++) {
      this._digest(c[i].mean, c[i].n);
    }
  };
  TDigest.prototype._cumulate = function(exact) {
    if (this.n === this.last_cumulate || !exact && this.CX && this.CX > this.n / this.last_cumulate) {
      return;
    }
    var cumn = 0;
    this.centroids.each(function(c) {
      c.mean_cumn = cumn + c.n / 2;
      cumn = c.cumn = cumn + c.n;
    });
    this.n = this.last_cumulate = cumn;
  };
  TDigest.prototype.find_nearest = function(x) {
    if (this.size() === 0) {
      return null;
    }
    var iter = this.centroids.lowerBound({ mean: x });
    var c = iter.data() === null ? iter.prev() : iter.data();
    if (c.mean === x || this.discrete) {
      return c;
    }
    var prev = iter.prev();
    if (prev && Math.abs(prev.mean - x) < Math.abs(c.mean - x)) {
      return prev;
    } else {
      return c;
    }
  };
  TDigest.prototype._new_centroid = function(x, n, cumn) {
    var c = { mean: x, n, cumn };
    this.centroids.insert(c);
    this.n += n;
    return c;
  };
  TDigest.prototype._addweight = function(nearest2, x, n) {
    if (x !== nearest2.mean) {
      nearest2.mean += n * (x - nearest2.mean) / (nearest2.n + n);
    }
    nearest2.cumn += n;
    nearest2.mean_cumn += n / 2;
    nearest2.n += n;
    this.n += n;
  };
  TDigest.prototype._digest = function(x, n) {
    var min4 = this.centroids.min();
    var max6 = this.centroids.max();
    var nearest2 = this.find_nearest(x);
    if (nearest2 && nearest2.mean === x) {
      this._addweight(nearest2, x, n);
    } else if (nearest2 === min4) {
      this._new_centroid(x, n, 0);
    } else if (nearest2 === max6) {
      this._new_centroid(x, n, this.n);
    } else if (this.discrete) {
      this._new_centroid(x, n, nearest2.cumn);
    } else {
      var p = nearest2.mean_cumn / this.n;
      var max_n = Math.floor(4 * this.n * this.delta * p * (1 - p));
      if (max_n - nearest2.n >= n) {
        this._addweight(nearest2, x, n);
      } else {
        this._new_centroid(x, n, nearest2.cumn);
      }
    }
    this._cumulate(false);
    if (!this.discrete && this.K && this.size() > this.K / this.delta) {
      this.compress();
    }
  };
  TDigest.prototype.bound_mean = function(x) {
    var iter = this.centroids.upperBound({ mean: x });
    var lower = iter.prev();
    var upper = lower.mean === x ? lower : iter.next();
    return [lower, upper];
  };
  TDigest.prototype.p_rank = function(x_or_xlist) {
    var xs = Array.isArray(x_or_xlist) ? x_or_xlist : [x_or_xlist];
    var ps = xs.map(this._p_rank, this);
    return Array.isArray(x_or_xlist) ? ps : ps[0];
  };
  TDigest.prototype._p_rank = function(x) {
    if (this.size() === 0) {
      return;
    } else if (x < this.centroids.min().mean) {
      return 0;
    } else if (x > this.centroids.max().mean) {
      return 1;
    }
    this._cumulate(true);
    var bound = this.bound_mean(x);
    var lower = bound[0], upper = bound[1];
    if (this.discrete) {
      return lower.cumn / this.n;
    } else {
      var cumn = lower.mean_cumn;
      if (lower !== upper) {
        cumn += (x - lower.mean) * (upper.mean_cumn - lower.mean_cumn) / (upper.mean - lower.mean);
      }
      return cumn / this.n;
    }
  };
  TDigest.prototype.bound_mean_cumn = function(cumn) {
    this.centroids._comparator = compare_centroid_mean_cumns;
    var iter = this.centroids.upperBound({ mean_cumn: cumn });
    this.centroids._comparator = compare_centroid_means;
    var lower = iter.prev();
    var upper = lower && lower.mean_cumn === cumn ? lower : iter.next();
    return [lower, upper];
  };
  TDigest.prototype.percentile = function(p_or_plist) {
    var ps = Array.isArray(p_or_plist) ? p_or_plist : [p_or_plist];
    var qs = ps.map(this._percentile, this);
    return Array.isArray(p_or_plist) ? qs : qs[0];
  };
  TDigest.prototype._percentile = function(p) {
    if (this.size() === 0) {
      return;
    }
    this._cumulate(true);
    var h = this.n * p;
    var bound = this.bound_mean_cumn(h);
    var lower = bound[0], upper = bound[1];
    if (upper === lower || lower === null || upper === null) {
      return (lower || upper).mean;
    } else if (!this.discrete) {
      return lower.mean + (h - lower.mean_cumn) * (upper.mean - lower.mean) / (upper.mean_cumn - lower.mean_cumn);
    } else if (h <= lower.cumn) {
      return lower.mean;
    } else {
      return upper.mean;
    }
  };
  function pop_random(choices) {
    var idx = Math.floor(Math.random() * choices.length);
    return choices.splice(idx, 1)[0];
  }
  TDigest.prototype.compress = function() {
    if (this.compressing) {
      return;
    }
    var points = this.toArray();
    this.reset();
    this.compressing = true;
    while (points.length > 0) {
      this.push_centroid(pop_random(points));
    }
    this._cumulate(true);
    this.compressing = false;
  };
  function Digest(config2) {
    this.config = config2 || {};
    this.mode = this.config.mode || "auto";
    TDigest.call(this, this.mode === "cont" ? config2.delta : false);
    this.digest_ratio = this.config.ratio || 0.9;
    this.digest_thresh = this.config.thresh || 1000;
    this.n_unique = 0;
  }
  Digest.prototype = Object.create(TDigest.prototype);
  Digest.prototype.constructor = Digest;
  Digest.prototype.push = function(x_or_xlist) {
    TDigest.prototype.push.call(this, x_or_xlist);
    this.check_continuous();
  };
  Digest.prototype._new_centroid = function(x, n, cumn) {
    this.n_unique += 1;
    TDigest.prototype._new_centroid.call(this, x, n, cumn);
  };
  Digest.prototype._addweight = function(nearest2, x, n) {
    if (nearest2.n === 1) {
      this.n_unique -= 1;
    }
    TDigest.prototype._addweight.call(this, nearest2, x, n);
  };
  Digest.prototype.check_continuous = function() {
    if (this.mode !== "auto" || this.size() < this.digest_thresh) {
      return false;
    }
    if (this.n_unique / this.size() > this.digest_ratio) {
      this.mode = "cont";
      this.discrete = false;
      this.delta = this.config.delta || 0.01;
      this.compress();
      return true;
    }
    return false;
  };
  module.exports = {
    TDigest,
    Digest
  };
});

// node_modules/prom-client/lib/timeWindowQuantiles.js
var require_timeWindowQuantiles = __commonJS((exports, module) => {
  var { TDigest } = require_tdigest();

  class TimeWindowQuantiles {
    constructor(maxAgeSeconds, ageBuckets) {
      this.maxAgeSeconds = maxAgeSeconds || 0;
      this.ageBuckets = ageBuckets || 0;
      this.shouldRotate = maxAgeSeconds && ageBuckets;
      this.ringBuffer = Array(ageBuckets).fill(new TDigest);
      this.currentBuffer = 0;
      this.lastRotateTimestampMillis = Date.now();
      this.durationBetweenRotatesMillis = maxAgeSeconds * 1000 / ageBuckets || Infinity;
    }
    size() {
      const bucket = rotate.call(this);
      return bucket.size();
    }
    percentile(quantile) {
      const bucket = rotate.call(this);
      return bucket.percentile(quantile);
    }
    push(value6) {
      rotate.call(this);
      this.ringBuffer.forEach((bucket) => {
        bucket.push(value6);
      });
    }
    reset() {
      this.ringBuffer.forEach((bucket) => {
        bucket.reset();
      });
    }
    compress() {
      this.ringBuffer.forEach((bucket) => {
        bucket.compress();
      });
    }
  }
  function rotate() {
    let timeSinceLastRotateMillis = Date.now() - this.lastRotateTimestampMillis;
    while (timeSinceLastRotateMillis > this.durationBetweenRotatesMillis && this.shouldRotate) {
      this.ringBuffer[this.currentBuffer] = new TDigest;
      if (++this.currentBuffer >= this.ringBuffer.length) {
        this.currentBuffer = 0;
      }
      timeSinceLastRotateMillis -= this.durationBetweenRotatesMillis;
      this.lastRotateTimestampMillis += this.durationBetweenRotatesMillis;
    }
    return this.ringBuffer[this.currentBuffer];
  }
  module.exports = TimeWindowQuantiles;
});

// node_modules/prom-client/lib/summary.js
var require_summary = __commonJS((exports, module) => {
  var util = __require("util");
  var { getLabels, hashObject, removeLabels } = require_util();
  var { validateLabel } = require_validation();
  var { Metric } = require_metric();
  var timeWindowQuantiles = require_timeWindowQuantiles();
  var DEFAULT_COMPRESS_COUNT = 1000;

  class Summary extends Metric {
    constructor(config2) {
      super(config2, {
        percentiles: [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999],
        compressCount: DEFAULT_COMPRESS_COUNT,
        hashMap: {}
      });
      this.type = "summary";
      for (const label of this.labelNames) {
        if (label === "quantile")
          throw new Error("quantile is a reserved label keyword");
      }
      if (this.labelNames.length === 0) {
        this.hashMap = {
          [hashObject({})]: {
            labels: {},
            td: new timeWindowQuantiles(this.maxAgeSeconds, this.ageBuckets),
            count: 0,
            sum: 0
          }
        };
      }
    }
    observe(labels, value6) {
      observe.call(this, labels === 0 ? 0 : labels || {})(value6);
    }
    async get() {
      if (this.collect) {
        const v = this.collect();
        if (v instanceof Promise)
          await v;
      }
      const hashKeys = Object.keys(this.hashMap);
      const values7 = [];
      hashKeys.forEach((hashKey) => {
        const s = this.hashMap[hashKey];
        if (s) {
          if (this.pruneAgedBuckets && s.td.size() === 0) {
            delete this.hashMap[hashKey];
          } else {
            extractSummariesForExport(s, this.percentiles).forEach((v) => {
              values7.push(v);
            });
            values7.push(getSumForExport(s, this));
            values7.push(getCountForExport(s, this));
          }
        }
      });
      return {
        name: this.name,
        help: this.help,
        type: this.type,
        values: values7,
        aggregator: this.aggregator
      };
    }
    reset() {
      const data = Object.values(this.hashMap);
      data.forEach((s) => {
        s.td.reset();
        s.count = 0;
        s.sum = 0;
      });
    }
    startTimer(labels) {
      return startTimer.call(this, labels)();
    }
    labels(...args2) {
      const labels = getLabels(this.labelNames, args2);
      validateLabel(this.labelNames, labels);
      return {
        observe: observe.call(this, labels),
        startTimer: startTimer.call(this, labels)
      };
    }
    remove(...args2) {
      const labels = getLabels(this.labelNames, args2);
      validateLabel(this.labelNames, labels);
      removeLabels.call(this, this.hashMap, labels, this.sortedLabelNames);
    }
  }
  function extractSummariesForExport(summaryOfLabels, percentiles) {
    summaryOfLabels.td.compress();
    return percentiles.map((percentile) => {
      const percentileValue = summaryOfLabels.td.percentile(percentile);
      return {
        labels: Object.assign({ quantile: percentile }, summaryOfLabels.labels),
        value: percentileValue ? percentileValue : 0
      };
    });
  }
  function getCountForExport(value6, summary6) {
    return {
      metricName: `${summary6.name}_count`,
      labels: value6.labels,
      value: value6.count
    };
  }
  function getSumForExport(value6, summary6) {
    return {
      metricName: `${summary6.name}_sum`,
      labels: value6.labels,
      value: value6.sum
    };
  }
  function startTimer(startLabels) {
    return () => {
      const start5 = process.hrtime();
      return (endLabels) => {
        const delta = process.hrtime(start5);
        const value6 = delta[0] + delta[1] / 1e9;
        this.observe(Object.assign({}, startLabels, endLabels), value6);
        return value6;
      };
    };
  }
  function observe(labels) {
    return (value6) => {
      const labelValuePair = convertLabelsAndValues(labels, value6);
      validateLabel(this.labelNames, labels);
      if (!Number.isFinite(labelValuePair.value)) {
        throw new TypeError(`Value is not a valid number: ${util.format(labelValuePair.value)}`);
      }
      const hash2 = hashObject(labelValuePair.labels, this.sortedLabelNames);
      let summaryOfLabel = this.hashMap[hash2];
      if (!summaryOfLabel) {
        summaryOfLabel = {
          labels: labelValuePair.labels,
          td: new timeWindowQuantiles(this.maxAgeSeconds, this.ageBuckets),
          count: 0,
          sum: 0
        };
      }
      summaryOfLabel.td.push(labelValuePair.value);
      summaryOfLabel.count++;
      if (summaryOfLabel.count % this.compressCount === 0) {
        summaryOfLabel.td.compress();
      }
      summaryOfLabel.sum += labelValuePair.value;
      this.hashMap[hash2] = summaryOfLabel;
    };
  }
  function convertLabelsAndValues(labels, value6) {
    if (value6 === undefined) {
      return {
        value: labels,
        labels: {}
      };
    }
    return {
      labels,
      value: value6
    };
  }
  module.exports = Summary;
});

// node_modules/prom-client/lib/pushgateway.js
var require_pushgateway = __commonJS((exports, module) => {
  var url2 = __require("url");
  var http = __require("http");
  var https = __require("https");
  var { gzipSync } = __require("zlib");
  var { globalRegistry } = require_registry();

  class Pushgateway {
    constructor(gatewayUrl, options, registry) {
      if (!registry) {
        registry = globalRegistry;
      }
      this.registry = registry;
      this.gatewayUrl = gatewayUrl;
      const { requireJobName, ...requestOptions } = {
        requireJobName: true,
        ...options
      };
      this.requireJobName = requireJobName;
      this.requestOptions = requestOptions;
    }
    pushAdd(params = {}) {
      if (this.requireJobName && !params.jobName) {
        throw new Error("Missing jobName parameter");
      }
      return useGateway.call(this, "POST", params.jobName, params.groupings);
    }
    push(params = {}) {
      if (this.requireJobName && !params.jobName) {
        throw new Error("Missing jobName parameter");
      }
      return useGateway.call(this, "PUT", params.jobName, params.groupings);
    }
    delete(params = {}) {
      if (this.requireJobName && !params.jobName) {
        throw new Error("Missing jobName parameter");
      }
      return useGateway.call(this, "DELETE", params.jobName, params.groupings);
    }
  }
  async function useGateway(method, job, groupings) {
    const gatewayUrlParsed = url2.parse(this.gatewayUrl);
    const gatewayUrlPath = gatewayUrlParsed.pathname && gatewayUrlParsed.pathname !== "/" ? gatewayUrlParsed.pathname : "";
    const jobPath = job ? `/job/${encodeURIComponent(job)}${generateGroupings(groupings)}` : "";
    const path = `${gatewayUrlPath}/metrics${jobPath}`;
    const target = url2.resolve(this.gatewayUrl, path);
    const requestParams = url2.parse(target);
    const httpModule = isHttps(requestParams.href) ? https : http;
    const options = Object.assign(requestParams, this.requestOptions, {
      method
    });
    return new Promise((resolve, reject2) => {
      if (method === "DELETE" && options.headers) {
        delete options.headers["Content-Encoding"];
      }
      const req = httpModule.request(options, (resp) => {
        let body = "";
        resp.setEncoding("utf8");
        resp.on("data", (chunk4) => {
          body += chunk4;
        });
        resp.on("end", () => {
          if (resp.statusCode >= 400) {
            reject2(new Error(`push failed with status ${resp.statusCode}, ${body}`));
          } else {
            resolve({ resp, body });
          }
        });
      });
      req.on("error", (err) => {
        reject2(err);
      });
      req.on("timeout", () => {
        req.destroy(new Error("Pushgateway request timed out"));
      });
      if (method !== "DELETE") {
        this.registry.metrics().then((metrics) => {
          if (options.headers && options.headers["Content-Encoding"] === "gzip") {
            metrics = gzipSync(metrics);
          }
          req.write(metrics);
          req.end();
        }).catch((err) => {
          reject2(err);
        });
      } else {
        req.end();
      }
    });
  }
  function generateGroupings(groupings) {
    if (!groupings) {
      return "";
    }
    return Object.keys(groupings).map((key) => `/${encodeURIComponent(key)}/${encodeURIComponent(groupings[key])}`).join("");
  }
  function isHttps(href) {
    return href.search(/^https/) !== -1;
  }
  module.exports = Pushgateway;
});

// node_modules/prom-client/lib/bucketGenerators.js
var require_bucketGenerators = __commonJS((exports) => {
  exports.linearBuckets = (start5, width, count5) => {
    if (count5 < 1) {
      throw new Error("Linear buckets needs a positive count");
    }
    const buckets = new Array(count5);
    for (let i = 0;i < count5; i++) {
      buckets[i] = start5 + i * width;
    }
    return buckets;
  };
  exports.exponentialBuckets = (start5, factor, count5) => {
    if (start5 <= 0) {
      throw new Error("Exponential buckets needs a positive start");
    }
    if (count5 < 1) {
      throw new Error("Exponential buckets needs a positive count");
    }
    if (factor <= 1) {
      throw new Error("Exponential buckets needs a factor greater than 1");
    }
    const buckets = new Array(count5);
    for (let i = 0;i < count5; i++) {
      buckets[i] = start5;
      start5 *= factor;
    }
    return buckets;
  };
});

// node_modules/prom-client/lib/metrics/processCpuTotal.js
var require_processCpuTotal = __commonJS((exports, module) => {
  var OtelApi = require_src();
  var Counter = require_counter();
  var PROCESS_CPU_USER_SECONDS = "process_cpu_user_seconds_total";
  var PROCESS_CPU_SYSTEM_SECONDS = "process_cpu_system_seconds_total";
  var PROCESS_CPU_SECONDS = "process_cpu_seconds_total";
  module.exports = (registry, config2 = {}) => {
    const registers = registry ? [registry] : undefined;
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const exemplars = config2.enableExemplars ? config2.enableExemplars : false;
    const labelNames = Object.keys(labels);
    let lastCpuUsage = process.cpuUsage();
    const cpuUserUsageCounter = new Counter({
      name: namePrefix + PROCESS_CPU_USER_SECONDS,
      help: "Total user CPU time spent in seconds.",
      enableExemplars: exemplars,
      registers,
      labelNames,
      collect() {
        const cpuUsage = process.cpuUsage();
        const userUsageMicros = cpuUsage.user - lastCpuUsage.user;
        const systemUsageMicros = cpuUsage.system - lastCpuUsage.system;
        lastCpuUsage = cpuUsage;
        if (this.enableExemplars) {
          let exemplarLabels = {};
          const currentSpan3 = OtelApi.trace.getSpan(OtelApi.context.active());
          if (currentSpan3) {
            exemplarLabels = {
              traceId: currentSpan3.spanContext().traceId,
              spanId: currentSpan3.spanContext().spanId
            };
          }
          cpuUserUsageCounter.inc({
            labels,
            value: userUsageMicros / 1e6,
            exemplarLabels
          });
          cpuSystemUsageCounter.inc({
            labels,
            value: systemUsageMicros / 1e6,
            exemplarLabels
          });
          cpuUsageCounter.inc({
            labels,
            value: (userUsageMicros + systemUsageMicros) / 1e6,
            exemplarLabels
          });
        } else {
          cpuUserUsageCounter.inc(labels, userUsageMicros / 1e6);
          cpuSystemUsageCounter.inc(labels, systemUsageMicros / 1e6);
          cpuUsageCounter.inc(labels, (userUsageMicros + systemUsageMicros) / 1e6);
        }
      }
    });
    const cpuSystemUsageCounter = new Counter({
      name: namePrefix + PROCESS_CPU_SYSTEM_SECONDS,
      help: "Total system CPU time spent in seconds.",
      enableExemplars: exemplars,
      registers,
      labelNames
    });
    const cpuUsageCounter = new Counter({
      name: namePrefix + PROCESS_CPU_SECONDS,
      help: "Total user and system CPU time spent in seconds.",
      enableExemplars: exemplars,
      registers,
      labelNames
    });
  };
  module.exports.metricNames = [
    PROCESS_CPU_USER_SECONDS,
    PROCESS_CPU_SYSTEM_SECONDS,
    PROCESS_CPU_SECONDS
  ];
});

// node_modules/prom-client/lib/metrics/processStartTime.js
var require_processStartTime = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var startInSeconds = Math.round(Date.now() / 1000 - process.uptime());
  var PROCESS_START_TIME = "process_start_time_seconds";
  module.exports = (registry, config2 = {}) => {
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + PROCESS_START_TIME,
      help: "Start time of the process since unix epoch in seconds.",
      registers: registry ? [registry] : undefined,
      labelNames,
      aggregator: "omit",
      collect() {
        this.set(labels, startInSeconds);
      }
    });
  };
  module.exports.metricNames = [PROCESS_START_TIME];
});

// node_modules/prom-client/lib/metrics/osMemoryHeapLinux.js
var require_osMemoryHeapLinux = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var fs = __require("fs");
  var values7 = ["VmSize", "VmRSS", "VmData"];
  var PROCESS_RESIDENT_MEMORY = "process_resident_memory_bytes";
  var PROCESS_VIRTUAL_MEMORY = "process_virtual_memory_bytes";
  var PROCESS_HEAP = "process_heap_bytes";
  function structureOutput(input) {
    return input.split(`
`).reduce((acc, string6) => {
      if (!values7.some((value7) => string6.startsWith(value7))) {
        return acc;
      }
      const split2 = string6.split(":");
      let value6 = split2[1].trim();
      value6 = value6.substr(0, value6.length - 3);
      value6 = Number(value6) * 1024;
      acc[split2[0]] = value6;
      return acc;
    }, {});
  }
  module.exports = (registry, config2 = {}) => {
    const registers = registry ? [registry] : undefined;
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    const residentMemGauge = new Gauge({
      name: namePrefix + PROCESS_RESIDENT_MEMORY,
      help: "Resident memory size in bytes.",
      registers,
      labelNames,
      collect() {
        try {
          const stat = fs.readFileSync("/proc/self/status", "utf8");
          const structuredOutput = structureOutput(stat);
          residentMemGauge.set(labels, structuredOutput.VmRSS);
          virtualMemGauge.set(labels, structuredOutput.VmSize);
          heapSizeMemGauge.set(labels, structuredOutput.VmData);
        } catch {}
      }
    });
    const virtualMemGauge = new Gauge({
      name: namePrefix + PROCESS_VIRTUAL_MEMORY,
      help: "Virtual memory size in bytes.",
      registers,
      labelNames
    });
    const heapSizeMemGauge = new Gauge({
      name: namePrefix + PROCESS_HEAP,
      help: "Process heap size in bytes.",
      registers,
      labelNames
    });
  };
  module.exports.metricNames = [
    PROCESS_RESIDENT_MEMORY,
    PROCESS_VIRTUAL_MEMORY,
    PROCESS_HEAP
  ];
});

// node_modules/prom-client/lib/metrics/helpers/safeMemoryUsage.js
var require_safeMemoryUsage = __commonJS((exports, module) => {
  function safeMemoryUsage() {
    try {
      return process.memoryUsage();
    } catch {
      return;
    }
  }
  module.exports = safeMemoryUsage;
});

// node_modules/prom-client/lib/metrics/osMemoryHeap.js
var require_osMemoryHeap = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var linuxVariant = require_osMemoryHeapLinux();
  var safeMemoryUsage = require_safeMemoryUsage();
  var PROCESS_RESIDENT_MEMORY = "process_resident_memory_bytes";
  function notLinuxVariant(registry, config2 = {}) {
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + PROCESS_RESIDENT_MEMORY,
      help: "Resident memory size in bytes.",
      registers: registry ? [registry] : undefined,
      labelNames,
      collect() {
        const memUsage = safeMemoryUsage();
        if (memUsage) {
          this.set(labels, memUsage.rss);
        }
      }
    });
  }
  module.exports = (registry, config2) => process.platform === "linux" ? linuxVariant(registry, config2) : notLinuxVariant(registry, config2);
  module.exports.metricNames = process.platform === "linux" ? linuxVariant.metricNames : [PROCESS_RESIDENT_MEMORY];
});

// node_modules/prom-client/lib/metrics/processOpenFileDescriptors.js
var require_processOpenFileDescriptors = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var fs = __require("fs");
  var process2 = __require("process");
  var PROCESS_OPEN_FDS = "process_open_fds";
  module.exports = (registry, config2 = {}) => {
    if (process2.platform !== "linux") {
      return;
    }
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + PROCESS_OPEN_FDS,
      help: "Number of open file descriptors.",
      registers: registry ? [registry] : undefined,
      labelNames,
      collect() {
        try {
          const fds = fs.readdirSync("/proc/self/fd");
          this.set(labels, fds.length - 1);
        } catch {}
      }
    });
  };
  module.exports.metricNames = [PROCESS_OPEN_FDS];
});

// node_modules/prom-client/lib/metrics/processMaxFileDescriptors.js
var require_processMaxFileDescriptors = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var fs = __require("fs");
  var PROCESS_MAX_FDS = "process_max_fds";
  var maxFds;
  module.exports = (registry, config2 = {}) => {
    if (maxFds === undefined) {
      try {
        const limits = fs.readFileSync("/proc/self/limits", "utf8");
        const lines = limits.split(`
`);
        for (const line of lines) {
          if (line.startsWith("Max open files")) {
            const parts2 = line.split(/  +/);
            maxFds = Number(parts2[1]);
            break;
          }
        }
      } catch {
        return;
      }
    }
    if (maxFds === undefined)
      return;
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + PROCESS_MAX_FDS,
      help: "Maximum number of open file descriptors.",
      registers: registry ? [registry] : undefined,
      labelNames,
      collect() {
        if (maxFds !== undefined)
          this.set(labels, maxFds);
      }
    });
  };
  module.exports.metricNames = [PROCESS_MAX_FDS];
});

// node_modules/prom-client/lib/metrics/eventLoopLag.js
var require_eventLoopLag = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var perf_hooks;
  try {
    perf_hooks = __require("perf_hooks");
  } catch {}
  var NODEJS_EVENTLOOP_LAG = "nodejs_eventloop_lag_seconds";
  var NODEJS_EVENTLOOP_LAG_MIN = "nodejs_eventloop_lag_min_seconds";
  var NODEJS_EVENTLOOP_LAG_MAX = "nodejs_eventloop_lag_max_seconds";
  var NODEJS_EVENTLOOP_LAG_MEAN = "nodejs_eventloop_lag_mean_seconds";
  var NODEJS_EVENTLOOP_LAG_STDDEV = "nodejs_eventloop_lag_stddev_seconds";
  var NODEJS_EVENTLOOP_LAG_P50 = "nodejs_eventloop_lag_p50_seconds";
  var NODEJS_EVENTLOOP_LAG_P90 = "nodejs_eventloop_lag_p90_seconds";
  var NODEJS_EVENTLOOP_LAG_P99 = "nodejs_eventloop_lag_p99_seconds";
  function reportEventloopLag(start5, gauge6, labels) {
    const delta = process.hrtime(start5);
    const nanosec = delta[0] * 1e9 + delta[1];
    const seconds2 = nanosec / 1e9;
    gauge6.set(labels, seconds2);
  }
  module.exports = (registry, config2 = {}) => {
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    const registers = registry ? [registry] : undefined;
    let collect3 = () => {
      const start5 = process.hrtime();
      setImmediate(reportEventloopLag, start5, lag, labels);
    };
    if (perf_hooks && perf_hooks.monitorEventLoopDelay) {
      try {
        const histogram6 = perf_hooks.monitorEventLoopDelay({
          resolution: config2.eventLoopMonitoringPrecision
        });
        histogram6.enable();
        collect3 = () => {
          const start5 = process.hrtime();
          setImmediate(reportEventloopLag, start5, lag, labels);
          lagMin.set(labels, histogram6.min / 1e9);
          lagMax.set(labels, histogram6.max / 1e9);
          lagMean.set(labels, histogram6.mean / 1e9);
          lagStddev.set(labels, histogram6.stddev / 1e9);
          lagP50.set(labels, histogram6.percentile(50) / 1e9);
          lagP90.set(labels, histogram6.percentile(90) / 1e9);
          lagP99.set(labels, histogram6.percentile(99) / 1e9);
          histogram6.reset();
        };
      } catch (e) {
        if (e.code === "ERR_NOT_IMPLEMENTED") {
          return;
        }
        throw e;
      }
    }
    const lag = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG,
      help: "Lag of event loop in seconds.",
      registers,
      labelNames,
      aggregator: "average",
      collect: collect3
    });
    const lagMin = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_MIN,
      help: "The minimum recorded event loop delay.",
      registers,
      labelNames,
      aggregator: "min"
    });
    const lagMax = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_MAX,
      help: "The maximum recorded event loop delay.",
      registers,
      labelNames,
      aggregator: "max"
    });
    const lagMean = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_MEAN,
      help: "The mean of the recorded event loop delays.",
      registers,
      labelNames,
      aggregator: "average"
    });
    const lagStddev = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_STDDEV,
      help: "The standard deviation of the recorded event loop delays.",
      registers,
      labelNames,
      aggregator: "average"
    });
    const lagP50 = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_P50,
      help: "The 50th percentile of the recorded event loop delays.",
      registers,
      labelNames,
      aggregator: "average"
    });
    const lagP90 = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_P90,
      help: "The 90th percentile of the recorded event loop delays.",
      registers,
      labelNames,
      aggregator: "average"
    });
    const lagP99 = new Gauge({
      name: namePrefix + NODEJS_EVENTLOOP_LAG_P99,
      help: "The 99th percentile of the recorded event loop delays.",
      registers,
      labelNames,
      aggregator: "average"
    });
  };
  module.exports.metricNames = [
    NODEJS_EVENTLOOP_LAG,
    NODEJS_EVENTLOOP_LAG_MIN,
    NODEJS_EVENTLOOP_LAG_MAX,
    NODEJS_EVENTLOOP_LAG_MEAN,
    NODEJS_EVENTLOOP_LAG_STDDEV,
    NODEJS_EVENTLOOP_LAG_P50,
    NODEJS_EVENTLOOP_LAG_P90,
    NODEJS_EVENTLOOP_LAG_P99
  ];
});

// node_modules/prom-client/lib/metrics/helpers/processMetricsHelpers.js
var require_processMetricsHelpers = __commonJS((exports, module) => {
  function aggregateByObjectName(list) {
    const data = {};
    for (let i = 0;i < list.length; i++) {
      const listElement = list[i];
      if (!listElement || typeof listElement.constructor === "undefined") {
        continue;
      }
      if (Object.hasOwnProperty.call(data, listElement.constructor.name)) {
        data[listElement.constructor.name] += 1;
      } else {
        data[listElement.constructor.name] = 1;
      }
    }
    return data;
  }
  function updateMetrics(gauge6, data, labels) {
    gauge6.reset();
    for (const key in data) {
      gauge6.set(Object.assign({ type: key }, labels || {}), data[key]);
    }
  }
  module.exports = {
    aggregateByObjectName,
    updateMetrics
  };
});

// node_modules/prom-client/lib/metrics/processHandles.js
var require_processHandles = __commonJS((exports, module) => {
  var { aggregateByObjectName } = require_processMetricsHelpers();
  var { updateMetrics } = require_processMetricsHelpers();
  var Gauge = require_gauge();
  var NODEJS_ACTIVE_HANDLES = "nodejs_active_handles";
  var NODEJS_ACTIVE_HANDLES_TOTAL = "nodejs_active_handles_total";
  module.exports = (registry, config2 = {}) => {
    if (typeof process._getActiveHandles !== "function") {
      return;
    }
    const registers = registry ? [registry] : undefined;
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + NODEJS_ACTIVE_HANDLES,
      help: "Number of active libuv handles grouped by handle type. Every handle type is C++ class name.",
      labelNames: ["type", ...labelNames],
      registers,
      collect() {
        const handles = process._getActiveHandles();
        updateMetrics(this, aggregateByObjectName(handles), labels);
      }
    });
    new Gauge({
      name: namePrefix + NODEJS_ACTIVE_HANDLES_TOTAL,
      help: "Total number of active handles.",
      registers,
      labelNames,
      collect() {
        const handles = process._getActiveHandles();
        this.set(labels, handles.length);
      }
    });
  };
  module.exports.metricNames = [
    NODEJS_ACTIVE_HANDLES,
    NODEJS_ACTIVE_HANDLES_TOTAL
  ];
});

// node_modules/prom-client/lib/metrics/processRequests.js
var require_processRequests = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var { aggregateByObjectName } = require_processMetricsHelpers();
  var { updateMetrics } = require_processMetricsHelpers();
  var NODEJS_ACTIVE_REQUESTS = "nodejs_active_requests";
  var NODEJS_ACTIVE_REQUESTS_TOTAL = "nodejs_active_requests_total";
  module.exports = (registry, config2 = {}) => {
    if (typeof process._getActiveRequests !== "function") {
      return;
    }
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + NODEJS_ACTIVE_REQUESTS,
      help: "Number of active libuv requests grouped by request type. Every request type is C++ class name.",
      labelNames: ["type", ...labelNames],
      registers: registry ? [registry] : undefined,
      collect() {
        const requests = process._getActiveRequests();
        updateMetrics(this, aggregateByObjectName(requests), labels);
      }
    });
    new Gauge({
      name: namePrefix + NODEJS_ACTIVE_REQUESTS_TOTAL,
      help: "Total number of active requests.",
      registers: registry ? [registry] : undefined,
      labelNames,
      collect() {
        const requests = process._getActiveRequests();
        this.set(labels, requests.length);
      }
    });
  };
  module.exports.metricNames = [
    NODEJS_ACTIVE_REQUESTS,
    NODEJS_ACTIVE_REQUESTS_TOTAL
  ];
});

// node_modules/prom-client/lib/metrics/processResources.js
var require_processResources = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var { updateMetrics } = require_processMetricsHelpers();
  var NODEJS_ACTIVE_RESOURCES = "nodejs_active_resources";
  var NODEJS_ACTIVE_RESOURCES_TOTAL = "nodejs_active_resources_total";
  module.exports = (registry, config2 = {}) => {
    if (typeof process.getActiveResourcesInfo !== "function") {
      return;
    }
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + NODEJS_ACTIVE_RESOURCES,
      help: "Number of active resources that are currently keeping the event loop alive, grouped by async resource type.",
      labelNames: ["type", ...labelNames],
      registers: registry ? [registry] : undefined,
      collect() {
        const resources = process.getActiveResourcesInfo();
        const data = {};
        for (let i = 0;i < resources.length; i++) {
          const resource = resources[i];
          if (Object.hasOwn(data, resource)) {
            data[resource] += 1;
          } else {
            data[resource] = 1;
          }
        }
        updateMetrics(this, data, labels);
      }
    });
    new Gauge({
      name: namePrefix + NODEJS_ACTIVE_RESOURCES_TOTAL,
      help: "Total number of active resources.",
      registers: registry ? [registry] : undefined,
      labelNames,
      collect() {
        const resources = process.getActiveResourcesInfo();
        this.set(labels, resources.length);
      }
    });
  };
  module.exports.metricNames = [
    NODEJS_ACTIVE_RESOURCES,
    NODEJS_ACTIVE_RESOURCES_TOTAL
  ];
});

// node_modules/prom-client/lib/metrics/heapSizeAndUsed.js
var require_heapSizeAndUsed = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var safeMemoryUsage = require_safeMemoryUsage();
  var NODEJS_HEAP_SIZE_TOTAL = "nodejs_heap_size_total_bytes";
  var NODEJS_HEAP_SIZE_USED = "nodejs_heap_size_used_bytes";
  var NODEJS_EXTERNAL_MEMORY = "nodejs_external_memory_bytes";
  module.exports = (registry, config2 = {}) => {
    if (typeof process.memoryUsage !== "function") {
      return;
    }
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    const registers = registry ? [registry] : undefined;
    const namePrefix = config2.prefix ? config2.prefix : "";
    const collect3 = () => {
      const memUsage = safeMemoryUsage();
      if (memUsage) {
        heapSizeTotal.set(labels, memUsage.heapTotal);
        heapSizeUsed.set(labels, memUsage.heapUsed);
        if (memUsage.external !== undefined) {
          externalMemUsed.set(labels, memUsage.external);
        }
      }
    };
    const heapSizeTotal = new Gauge({
      name: namePrefix + NODEJS_HEAP_SIZE_TOTAL,
      help: "Process heap size from Node.js in bytes.",
      registers,
      labelNames,
      collect: collect3
    });
    const heapSizeUsed = new Gauge({
      name: namePrefix + NODEJS_HEAP_SIZE_USED,
      help: "Process heap size used from Node.js in bytes.",
      registers,
      labelNames
    });
    const externalMemUsed = new Gauge({
      name: namePrefix + NODEJS_EXTERNAL_MEMORY,
      help: "Node.js external memory size in bytes.",
      registers,
      labelNames
    });
  };
  module.exports.metricNames = [
    NODEJS_HEAP_SIZE_TOTAL,
    NODEJS_HEAP_SIZE_USED,
    NODEJS_EXTERNAL_MEMORY
  ];
});

// node_modules/prom-client/lib/metrics/heapSpacesSizeAndUsed.js
var require_heapSpacesSizeAndUsed = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var v8 = __require("v8");
  var METRICS = ["total", "used", "available"];
  var NODEJS_HEAP_SIZE = {};
  METRICS.forEach((metricType) => {
    NODEJS_HEAP_SIZE[metricType] = `nodejs_heap_space_size_${metricType}_bytes`;
  });
  module.exports = (registry, config2 = {}) => {
    try {
      v8.getHeapSpaceStatistics();
    } catch (e) {
      if (e.code === "ERR_NOT_IMPLEMENTED") {
        return;
      }
      throw e;
    }
    const registers = registry ? [registry] : undefined;
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = ["space", ...Object.keys(labels)];
    const gauges = {};
    METRICS.forEach((metricType) => {
      gauges[metricType] = new Gauge({
        name: namePrefix + NODEJS_HEAP_SIZE[metricType],
        help: `Process heap space size ${metricType} from Node.js in bytes.`,
        labelNames,
        registers
      });
    });
    gauges.total.collect = () => {
      for (const space of v8.getHeapSpaceStatistics()) {
        const spaceName = space.space_name.substr(0, space.space_name.indexOf("_space"));
        gauges.total.set({ space: spaceName, ...labels }, space.space_size);
        gauges.used.set({ space: spaceName, ...labels }, space.space_used_size);
        gauges.available.set({ space: spaceName, ...labels }, space.space_available_size);
      }
    };
  };
  module.exports.metricNames = Object.values(NODEJS_HEAP_SIZE);
});

// node_modules/prom-client/lib/metrics/version.js
var require_version2 = __commonJS((exports, module) => {
  var Gauge = require_gauge();
  var version = process.version;
  var versionSegments = version.slice(1).split(".").map(Number);
  var NODE_VERSION_INFO = "nodejs_version_info";
  module.exports = (registry, config2 = {}) => {
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    new Gauge({
      name: namePrefix + NODE_VERSION_INFO,
      help: "Node.js version info.",
      labelNames: ["version", "major", "minor", "patch", ...labelNames],
      registers: registry ? [registry] : undefined,
      aggregator: "first",
      collect() {
        this.labels(version, versionSegments[0], versionSegments[1], versionSegments[2], ...Object.values(labels)).set(1);
      }
    });
  };
  module.exports.metricNames = [NODE_VERSION_INFO];
});

// node_modules/prom-client/lib/metrics/gc.js
var require_gc = __commonJS((exports, module) => {
  var Histogram = require_histogram();
  var perf_hooks;
  try {
    perf_hooks = __require("perf_hooks");
  } catch {}
  var NODEJS_GC_DURATION_SECONDS = "nodejs_gc_duration_seconds";
  var DEFAULT_GC_DURATION_BUCKETS = [0.001, 0.01, 0.1, 1, 2, 5];
  var kinds = [];
  if (perf_hooks && perf_hooks.constants) {
    kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_MAJOR] = "major";
    kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_MINOR] = "minor";
    kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_INCREMENTAL] = "incremental";
    kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_WEAKCB] = "weakcb";
  }
  module.exports = (registry, config2 = {}) => {
    if (!perf_hooks) {
      return;
    }
    const namePrefix = config2.prefix ? config2.prefix : "";
    const labels = config2.labels ? config2.labels : {};
    const labelNames = Object.keys(labels);
    const buckets = config2.gcDurationBuckets ? config2.gcDurationBuckets : DEFAULT_GC_DURATION_BUCKETS;
    const gcHistogram = new Histogram({
      name: namePrefix + NODEJS_GC_DURATION_SECONDS,
      help: "Garbage collection duration by kind, one of major, minor, incremental or weakcb.",
      labelNames: ["kind", ...labelNames],
      enableExemplars: false,
      buckets,
      registers: registry ? [registry] : undefined
    });
    const obs = new perf_hooks.PerformanceObserver((list) => {
      const entry = list.getEntries()[0];
      const kind = entry.detail ? kinds[entry.detail.kind] : kinds[entry.kind];
      gcHistogram.observe(Object.assign({ kind }, labels), entry.duration / 1000);
    });
    obs.observe({ entryTypes: ["gc"] });
  };
  module.exports.metricNames = [NODEJS_GC_DURATION_SECONDS];
});

// node_modules/prom-client/lib/defaultMetrics.js
var require_defaultMetrics = __commonJS((exports, module) => {
  var { isObject: isObject2 } = require_util();
  var processCpuTotal = require_processCpuTotal();
  var processStartTime = require_processStartTime();
  var osMemoryHeap = require_osMemoryHeap();
  var processOpenFileDescriptors = require_processOpenFileDescriptors();
  var processMaxFileDescriptors = require_processMaxFileDescriptors();
  var eventLoopLag = require_eventLoopLag();
  var processHandles = require_processHandles();
  var processRequests = require_processRequests();
  var processResources = require_processResources();
  var heapSizeAndUsed = require_heapSizeAndUsed();
  var heapSpacesSizeAndUsed = require_heapSpacesSizeAndUsed();
  var version = require_version2();
  var gc = require_gc();
  var metrics = {
    processCpuTotal,
    processStartTime,
    osMemoryHeap,
    processOpenFileDescriptors,
    processMaxFileDescriptors,
    eventLoopLag,
    ...typeof process.getActiveResourcesInfo === "function" ? { processResources } : {},
    processHandles,
    processRequests,
    heapSizeAndUsed,
    heapSpacesSizeAndUsed,
    version,
    gc
  };
  var metricsList = Object.keys(metrics);
  module.exports = function collectDefaultMetrics(config2) {
    if (config2 !== null && config2 !== undefined && !isObject2(config2)) {
      throw new TypeError("config must be null, undefined, or an object");
    }
    config2 = { eventLoopMonitoringPrecision: 10, ...config2 };
    for (const metric of Object.values(metrics)) {
      metric(config2.register, config2);
    }
  };
  module.exports.metricsList = metricsList;
});

// node_modules/prom-client/lib/metricAggregators.js
var require_metricAggregators = __commonJS((exports) => {
  var { Grouper, hashObject } = require_util();
  function AggregatorFactory(aggregatorFn) {
    return (metrics) => {
      if (metrics.length === 0)
        return;
      const result = {
        help: metrics[0].help,
        name: metrics[0].name,
        type: metrics[0].type,
        values: [],
        aggregator: metrics[0].aggregator
      };
      const byLabels = new Grouper;
      metrics.forEach((metric) => {
        metric.values.forEach((value6) => {
          const key = hashObject(value6.labels);
          byLabels.add(`${value6.metricName}_${key}`, value6);
        });
      });
      byLabels.forEach((values7) => {
        if (values7.length === 0)
          return;
        const valObj = {
          value: aggregatorFn(values7),
          labels: values7[0].labels
        };
        if (values7[0].metricName) {
          valObj.metricName = values7[0].metricName;
        }
        result.values.push(valObj);
      });
      return result;
    };
  }
  exports.AggregatorFactory = AggregatorFactory;
  exports.aggregators = {
    sum: AggregatorFactory((v) => v.reduce((p, c) => p + c.value, 0)),
    first: AggregatorFactory((v) => v[0].value),
    omit: () => {},
    average: AggregatorFactory((v) => v.reduce((p, c) => p + c.value, 0) / v.length),
    min: AggregatorFactory((v) => v.reduce((p, c) => Math.min(p, c.value), Infinity)),
    max: AggregatorFactory((v) => v.reduce((p, c) => Math.max(p, c.value), -Infinity))
  };
});

// node_modules/prom-client/lib/cluster.js
var require_cluster = __commonJS((exports, module) => {
  var Registry = require_registry();
  var { Grouper } = require_util();
  var { aggregators } = require_metricAggregators();
  var cluster = () => {
    const data = __require("cluster");
    cluster = () => data;
    return data;
  };
  var GET_METRICS_REQ = "prom-client:getMetricsReq";
  var GET_METRICS_RES = "prom-client:getMetricsRes";
  var registries = [Registry.globalRegistry];
  var requestCtr = 0;
  var listenersAdded = false;
  var requests = new Map;

  class AggregatorRegistry extends Registry {
    constructor(regContentType = Registry.PROMETHEUS_CONTENT_TYPE) {
      super(regContentType);
      addListeners();
    }
    clusterMetrics() {
      const requestId = requestCtr++;
      return new Promise((resolve, reject2) => {
        let settled = false;
        function done14(err, result) {
          if (settled)
            return;
          settled = true;
          if (err)
            reject2(err);
          else
            resolve(result);
        }
        const request2 = {
          responses: [],
          pending: 0,
          done: done14,
          errorTimeout: setTimeout(() => {
            const err = new Error("Operation timed out.");
            request2.done(err);
          }, 5000)
        };
        requests.set(requestId, request2);
        const message = {
          type: GET_METRICS_REQ,
          requestId
        };
        for (const id2 in cluster().workers) {
          if (cluster().workers[id2].isConnected()) {
            cluster().workers[id2].send(message);
            request2.pending++;
          }
        }
        if (request2.pending === 0) {
          clearTimeout(request2.errorTimeout);
          process.nextTick(() => done14(null, ""));
        }
      });
    }
    get contentType() {
      return super.contentType;
    }
    static aggregate(metricsArr, registryType = Registry.PROMETHEUS_CONTENT_TYPE) {
      const aggregatedRegistry = new Registry;
      const metricsByName = new Grouper;
      aggregatedRegistry.setContentType(registryType);
      metricsArr.forEach((metrics) => {
        metrics.forEach((metric) => {
          metricsByName.add(metric.name, metric);
        });
      });
      metricsByName.forEach((metrics) => {
        const aggregatorName = metrics[0].aggregator;
        const aggregatorFn = aggregators[aggregatorName];
        if (typeof aggregatorFn !== "function") {
          throw new Error(`'${aggregatorName}' is not a defined aggregator.`);
        }
        const aggregatedMetric = aggregatorFn(metrics);
        if (aggregatedMetric) {
          const aggregatedMetricWrapper = Object.assign({
            get: () => aggregatedMetric
          }, aggregatedMetric);
          aggregatedRegistry.registerMetric(aggregatedMetricWrapper);
        }
      });
      return aggregatedRegistry;
    }
    static setRegistries(regs) {
      if (!Array.isArray(regs))
        regs = [regs];
      regs.forEach((reg) => {
        if (!(reg instanceof Registry)) {
          throw new TypeError(`Expected Registry, got ${typeof reg}`);
        }
      });
      registries = regs;
    }
  }
  function addListeners() {
    if (listenersAdded)
      return;
    listenersAdded = true;
    if (cluster().isMaster) {
      cluster().on("message", (worker, message) => {
        if (message.type === GET_METRICS_RES) {
          const request2 = requests.get(message.requestId);
          if (message.error) {
            request2.done(new Error(message.error));
            return;
          }
          message.metrics.forEach((registry) => request2.responses.push(registry));
          request2.pending--;
          if (request2.pending === 0) {
            requests.delete(message.requestId);
            clearTimeout(request2.errorTimeout);
            const registry = AggregatorRegistry.aggregate(request2.responses);
            const promString = registry.metrics();
            request2.done(null, promString);
          }
        }
      });
    }
    if (cluster().isWorker) {
      process.on("message", (message) => {
        if (message.type === GET_METRICS_REQ) {
          Promise.all(registries.map((r) => r.getMetricsAsJSON())).then((metrics) => {
            process.send({
              type: GET_METRICS_RES,
              requestId: message.requestId,
              metrics
            });
          }).catch((error2) => {
            process.send({
              type: GET_METRICS_RES,
              requestId: message.requestId,
              error: error2.message
            });
          });
        }
      });
    }
  }
  module.exports = AggregatorRegistry;
});

// node_modules/prom-client/index.js
var require_prom_client = __commonJS((exports) => {
  exports.register = require_registry().globalRegistry;
  exports.Registry = require_registry();
  Object.defineProperty(exports, "contentType", {
    configurable: false,
    enumerable: true,
    get() {
      return exports.register.contentType;
    },
    set(value6) {
      exports.register.setContentType(value6);
    }
  });
  exports.prometheusContentType = exports.Registry.PROMETHEUS_CONTENT_TYPE;
  exports.openMetricsContentType = exports.Registry.OPENMETRICS_CONTENT_TYPE;
  exports.validateMetricName = require_validation().validateMetricName;
  exports.Counter = require_counter();
  exports.Gauge = require_gauge();
  exports.Histogram = require_histogram();
  exports.Summary = require_summary();
  exports.Pushgateway = require_pushgateway();
  exports.linearBuckets = require_bucketGenerators().linearBuckets;
  exports.exponentialBuckets = require_bucketGenerators().exponentialBuckets;
  exports.collectDefaultMetrics = require_defaultMetrics();
  exports.aggregators = require_metricAggregators().aggregators;
  exports.AggregatorRegistry = require_cluster();
});

// packages/metrics/src/metrics.service.ts
var exports_metrics_service = {};
__export(exports_metrics_service, {
  makeMetricsService: () => makeMetricsService,
  createMetricsService: () => createMetricsService,
  MetricsService: () => MetricsService
});

class MetricsServiceImpl {
  options;
  httpRequestsTotal;
  httpRequestDuration;
  systemMemoryUsage;
  systemCpuUsage;
  systemUptime;
  systemMetricsInterval;
  cpuUsageBaseline;
  constructor(options = {}) {
    this.options = {
      enabled: true,
      path: "/metrics",
      collectHttpMetrics: true,
      collectSystemMetrics: true,
      collectGcMetrics: true,
      systemMetricsInterval: 5000,
      prefix: "onebun_",
      httpDurationBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      ...options
    };
    this.cpuUsageBaseline = process.cpuUsage();
    if (this.options.enabled) {
      this.initializeMetrics();
    }
  }
  initializeMetrics() {
    if (this.options.defaultLabels) {
      import_prom_client.register.setDefaultLabels(this.options.defaultLabels);
    }
    if (this.options.collectGcMetrics) {
      import_prom_client.collectDefaultMetrics({
        register: import_prom_client.register,
        prefix: this.options.prefix,
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
      });
    }
    if (this.options.collectHttpMetrics) {
      this.initializeHttpMetrics();
    }
    if (this.options.collectSystemMetrics) {
      this.initializeSystemMetrics();
    }
  }
  initializeHttpMetrics() {
    this.httpRequestsTotal = new import_prom_client.Counter({
      name: `${this.options.prefix}http_requests_total`,
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status_code", "controller", "action"],
      registers: [import_prom_client.register]
    });
    this.httpRequestDuration = new import_prom_client.Histogram({
      name: `${this.options.prefix}http_request_duration_seconds`,
      help: "HTTP request duration in seconds",
      labelNames: ["method", "route", "status_code", "controller", "action"],
      buckets: this.options.httpDurationBuckets,
      registers: [import_prom_client.register]
    });
  }
  initializeSystemMetrics() {
    this.systemMemoryUsage = new import_prom_client.Gauge({
      name: `${this.options.prefix}memory_usage_bytes`,
      help: "Memory usage in bytes",
      labelNames: ["type"],
      registers: [import_prom_client.register]
    });
    this.systemCpuUsage = new import_prom_client.Gauge({
      name: `${this.options.prefix}cpu_usage_ratio`,
      help: "CPU usage ratio",
      registers: [import_prom_client.register]
    });
    this.systemUptime = new import_prom_client.Gauge({
      name: `${this.options.prefix}uptime_seconds`,
      help: "Process uptime in seconds",
      registers: [import_prom_client.register]
    });
  }
  async getMetrics() {
    if (!this.options.enabled) {
      return "";
    }
    return import_prom_client.register.metrics();
  }
  getContentType() {
    return import_prom_client.register.contentType;
  }
  recordHttpRequest(data) {
    if (!this.options.enabled || !this.options.collectHttpMetrics) {
      return;
    }
    const labels = {
      method: data.method.toUpperCase(),
      route: data.route,
      status_code: data.statusCode.toString(),
      controller: data.controller || "unknown",
      action: data.action || "unknown"
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, data.duration);
  }
  createCounter(config2) {
    return new import_prom_client.Counter({
      name: `${this.options.prefix}${config2.name}`,
      help: config2.help,
      labelNames: config2.labelNames || [],
      registers: [import_prom_client.register]
    });
  }
  createGauge(config2) {
    return new import_prom_client.Gauge({
      name: `${this.options.prefix}${config2.name}`,
      help: config2.help,
      labelNames: config2.labelNames || [],
      registers: [import_prom_client.register]
    });
  }
  createHistogram(config2) {
    return new import_prom_client.Histogram({
      name: `${this.options.prefix}${config2.name}`,
      help: config2.help,
      labelNames: config2.labelNames || [],
      buckets: config2.buckets || [0.001, 0.01, 0.1, 1, 10],
      registers: [import_prom_client.register]
    });
  }
  createSummary(config2) {
    return new import_prom_client.Summary({
      name: `${this.options.prefix}${config2.name}`,
      help: config2.help,
      labelNames: config2.labelNames || [],
      percentiles: config2.percentiles || [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999],
      maxAgeSeconds: config2.maxAgeSeconds || 600,
      ageBuckets: config2.ageBuckets || 5,
      registers: [import_prom_client.register]
    });
  }
  getMetric(name) {
    const fullName = name.startsWith(this.options.prefix) ? name : `${this.options.prefix}${name}`;
    return import_prom_client.register.getSingleMetric(fullName);
  }
  clear() {
    import_prom_client.register.clear();
  }
  getRegistry() {
    return {
      getMetrics: () => this.getMetrics(),
      getContentType: () => this.getContentType(),
      clear: () => this.clear(),
      register: import_prom_client.register
    };
  }
  startSystemMetricsCollection() {
    if (!this.options.enabled || !this.options.collectSystemMetrics || this.systemMetricsInterval) {
      return;
    }
    this.systemMetricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.systemMetricsInterval);
    this.collectSystemMetrics();
  }
  stopSystemMetricsCollection() {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
      this.systemMetricsInterval = undefined;
    }
  }
  collectSystemMetrics() {
    try {
      const memUsage = process.memoryUsage();
      this.systemMemoryUsage.set({ type: "rss" }, memUsage.rss);
      this.systemMemoryUsage.set({ type: "heap_used" }, memUsage.heapUsed);
      this.systemMemoryUsage.set({ type: "heap_total" }, memUsage.heapTotal);
      this.systemMemoryUsage.set({ type: "external" }, memUsage.external);
      const cpuUsage = process.cpuUsage(this.cpuUsageBaseline);
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1e6;
      this.systemCpuUsage.set(cpuPercent);
      this.cpuUsageBaseline = process.cpuUsage();
      this.systemUptime.set(process.uptime());
    } catch (error2) {
      console.warn("Failed to collect system metrics:", error2);
    }
  }
}
var import_prom_client, MetricsService, makeMetricsService = (options) => exports_Layer.succeed(MetricsService, new MetricsServiceImpl(options)), createMetricsService = (options) => exports_Effect.succeed(new MetricsServiceImpl(options));
var init_metrics_service = __esm(() => {
  init_esm();
  import_prom_client = __toESM(require_prom_client(), 1);
  MetricsService = exports_Context.GenericTag("@onebun/metrics/MetricsService");
});

// packages/metrics/src/types.ts
var MetricType;
var init_types = __esm(() => {
  ((MetricType2) => {
    MetricType2["COUNTER"] = "counter";
    MetricType2["GAUGE"] = "gauge";
    MetricType2["HISTOGRAM"] = "histogram";
    MetricType2["SUMMARY"] = "summary";
  })(MetricType ||= {});
});

// packages/metrics/src/middleware.ts
class MetricsMiddleware {
  metricsService;
  constructor(metricsService) {
    this.metricsService = metricsService;
  }
  createHttpMetricsMiddleware() {
    return async (req, context10 = {}) => {
      const startTime = Date.now();
      return (response, requestStartTime) => {
        const duration3 = (Date.now() - requestStartTime) / 1000;
        const url2 = new URL(req.url);
        const metricsData = {
          method: req.method,
          route: context10.route || url2.pathname,
          statusCode: response.status,
          duration: duration3,
          controller: context10.controller,
          action: context10.action
        };
        this.metricsService.recordHttpRequest(metricsData);
      };
    };
  }
  wrapControllerMethod(originalMethod, controllerName, methodName, route) {
    return async (...args2) => {
      const startTime = Date.now();
      let statusCode = 200;
      let error2;
      try {
        const result = await originalMethod.apply(this, args2);
        if (result instanceof Response) {
          statusCode = result.status;
        }
        return result;
      } catch (err) {
        error2 = err;
        statusCode = 500;
        throw err;
      } finally {
        const duration3 = (Date.now() - startTime) / 1000;
        this.metricsService.recordHttpRequest({
          method: "UNKNOWN",
          route,
          statusCode,
          duration: duration3,
          controller: controllerName,
          action: methodName
        });
      }
    };
  }
}
function WithMetrics(route) {
  return function(target, propertyKey, descriptor3) {
    const originalMethod = descriptor3.value;
    const controllerName = target.constructor.name;
    const routePath = route || `/${propertyKey}`;
    descriptor3.value = function(...args2) {
      const startTime = Date.now();
      try {
        const result = originalMethod.apply(this, args2);
        if (result instanceof Promise) {
          return result.then((res) => {
            recordMetrics(controllerName, propertyKey, routePath, startTime, 200);
            return res;
          }).catch((err) => {
            recordMetrics(controllerName, propertyKey, routePath, startTime, 500);
            throw err;
          });
        } else {
          recordMetrics(controllerName, propertyKey, routePath, startTime, 200);
          return result;
        }
      } catch (err) {
        recordMetrics(controllerName, propertyKey, routePath, startTime, 500);
        throw err;
      }
    };
    return descriptor3;
  };
}
function recordMetrics(controller, action, route, startTime, statusCode) {
  const duration3 = (Date.now() - startTime) / 1000;
  if (typeof globalThis !== "undefined" && globalThis.__onebunMetricsService) {
    const metricsService = globalThis.__onebunMetricsService;
    metricsService.recordHttpRequest({
      method: "UNKNOWN",
      route,
      statusCode,
      duration: duration3,
      controller,
      action
    });
  }
}
var recordHttpMetrics = (data) => exports_Effect.gen(function* () {
  const metricsService = yield* MetricsService;
  metricsService.recordHttpRequest(data);
});
var init_middleware = __esm(() => {
  init_esm();
  init_metrics_service();
});

// packages/metrics/src/decorators.ts
function MeasureTime(metricName, labels) {
  return function(target, propertyKey, descriptor3) {
    const originalMethod = descriptor3.value;
    const methodName = metricName || `${target.constructor.name}_${propertyKey}_duration`;
    descriptor3.value = function(...args2) {
      const startTime = Date.now();
      try {
        const result = originalMethod.apply(this, args2);
        if (result instanceof Promise) {
          return result.then((res) => {
            recordDuration(methodName, startTime, labels);
            return res;
          }).catch((err) => {
            recordDuration(methodName, startTime, labels);
            throw err;
          });
        } else {
          recordDuration(methodName, startTime, labels);
          return result;
        }
      } catch (err) {
        recordDuration(methodName, startTime, labels);
        throw err;
      }
    };
    return descriptor3;
  };
}
function CountCalls(metricName, labels) {
  return function(target, propertyKey, descriptor3) {
    const originalMethod = descriptor3.value;
    const counterName = metricName || `${target.constructor.name}_${propertyKey}_calls_total`;
    descriptor3.value = function(...args2) {
      incrementCounter(counterName, labels);
      return originalMethod.apply(this, args2);
    };
    return descriptor3;
  };
}
function MeasureGauge(metricName, getValue, labels) {
  return function(target, propertyKey, descriptor3) {
    const originalMethod = descriptor3.value;
    descriptor3.value = function(...args2) {
      const result = originalMethod.apply(this, args2);
      const updateGauge = () => {
        try {
          const value6 = getValue();
          setGaugeValue(metricName, value6, labels);
        } catch (error2) {
          console.warn(`Failed to update gauge ${metricName}:`, error2);
        }
      };
      if (result instanceof Promise) {
        return result.then((res) => {
          updateGauge();
          return res;
        });
      } else {
        updateGauge();
        return result;
      }
    };
    return descriptor3;
  };
}
function InjectMetric(config2) {
  return function(target, propertyKey) {
    console.log(`Metric ${config2.name} will be injected into ${target.constructor.name}.${propertyKey}`);
  };
}
function WithMetrics2(options = {}) {
  return function(constructor) {
    return class extends constructor {
      constructor(...args2) {
        super(...args2);
        console.log(`WithMetrics applied to ${constructor.name} with prefix: ${options.prefix || "none"}`);
      }
    };
  };
}
function recordDuration(metricName, startTime, labels) {
  const metricsService = getMetricsService();
  if (!metricsService)
    return;
  const duration3 = (Date.now() - startTime) / 1000;
  const histogram6 = metricsService.getMetric(metricName);
  if (histogram6 && typeof histogram6.observe === "function") {
    histogram6.observe(labels ? { labels: labels.join(",") } : {}, duration3);
  }
}
function incrementCounter(metricName, labels) {
  const metricsService = getMetricsService();
  if (!metricsService)
    return;
  const counter6 = metricsService.getMetric(metricName);
  if (counter6 && typeof counter6.inc === "function") {
    counter6.inc(labels ? { labels: labels.join(",") } : {});
  }
}
function setGaugeValue(metricName, value6, labels) {
  const metricsService = getMetricsService();
  if (!metricsService)
    return;
  const gauge6 = metricsService.getMetric(metricName);
  if (gauge6 && typeof gauge6.set === "function") {
    gauge6.set(labels ? { labels: labels.join(",") } : {}, value6);
  }
}
function getMetricsService() {
  if (typeof globalThis !== "undefined") {
    return globalThis.__onebunMetricsService;
  }
  return;
}
var measureExecutionTime = (metricName, effect4) => exports_Effect.gen(function* () {
  const metricsService = yield* MetricsService;
  const startTime = Date.now();
  try {
    const result = yield* effect4;
    const duration3 = (Date.now() - startTime) / 1000;
    const histogram6 = metricsService.getMetric(metricName);
    if (histogram6 && typeof histogram6.observe === "function") {
      histogram6.observe({}, duration3);
    }
    return result;
  } catch (error2) {
    const duration3 = (Date.now() - startTime) / 1000;
    const histogram6 = metricsService.getMetric(metricName);
    if (histogram6 && typeof histogram6.observe === "function") {
      histogram6.observe({ status: "error" }, duration3);
    }
    throw error2;
  }
});
var init_decorators = __esm(() => {
  init_esm();
  init_metrics_service();
});

// packages/metrics/src/index.ts
var exports_src = {};
__export(exports_src, {
  recordHttpMetrics: () => recordHttpMetrics,
  measureExecutionTime: () => measureExecutionTime,
  makeMetricsService: () => makeMetricsService,
  makeDefaultMetricsService: () => makeDefaultMetricsService,
  createMetricsService: () => createMetricsService,
  createDefaultMetricsService: () => createDefaultMetricsService,
  WithMetricsMiddleware: () => WithMetrics,
  WithMetrics: () => WithMetrics2,
  MetricsService: () => MetricsService,
  MetricsMiddleware: () => MetricsMiddleware,
  MetricType: () => MetricType,
  MeasureTime: () => MeasureTime,
  MeasureGauge: () => MeasureGauge,
  InjectMetric: () => InjectMetric,
  DEFAULT_METRICS_OPTIONS: () => DEFAULT_METRICS_OPTIONS,
  CountCalls: () => CountCalls
});
var DEFAULT_METRICS_OPTIONS, createDefaultMetricsService = (overrides = {}) => {
  const { createMetricsService: createMetricsService2 } = (init_metrics_service(), __toCommonJS(exports_metrics_service));
  return createMetricsService2({
    ...DEFAULT_METRICS_OPTIONS,
    ...overrides
  });
}, makeDefaultMetricsService = (overrides = {}) => {
  const { makeMetricsService: makeMetricsService2 } = (init_metrics_service(), __toCommonJS(exports_metrics_service));
  return makeMetricsService2({
    ...DEFAULT_METRICS_OPTIONS,
    ...overrides
  });
};
var init_src = __esm(() => {
  init_metrics_service();
  init_types();
  init_middleware();
  init_decorators();
  DEFAULT_METRICS_OPTIONS = {
    enabled: true,
    path: "/metrics",
    defaultLabels: {},
    collectHttpMetrics: true,
    collectSystemMetrics: true,
    collectGcMetrics: true,
    systemMetricsInterval: 5000,
    prefix: "onebun_",
    httpDurationBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  };
});

// packages/core/src/application.ts
init_esm();

// packages/core/src/metadata.ts
var metadataStorage = new WeakMap;
function defineMetadata(metadataKey, metadataValue, target, propertyKey) {
  let targetMetadata = metadataStorage.get(target);
  if (!targetMetadata) {
    targetMetadata = new Map;
    metadataStorage.set(target, targetMetadata);
  }
  let keyMetadata = targetMetadata.get(metadataKey);
  if (!keyMetadata) {
    keyMetadata = new Map;
    targetMetadata.set(metadataKey, keyMetadata);
  }
  keyMetadata.set(propertyKey || "", metadataValue);
}
function getMetadata(metadataKey, target, propertyKey) {
  const targetMetadata = metadataStorage.get(target);
  if (!targetMetadata) {
    return;
  }
  const keyMetadata = targetMetadata.get(metadataKey);
  if (!keyMetadata) {
    return;
  }
  return keyMetadata.get(propertyKey || "");
}
function setConstructorParamTypes(target, types) {
  defineMetadata("design:paramtypes", types, target);
}
if (typeof globalThis.__decorate === "undefined") {
  globalThis.__decorate = function(decorators, target, propertyKey, descriptor3) {
    console.log("__decorate", decorators, target, propertyKey, descriptor3);
    if (arguments.length === 2 && typeof target === "function") {
      const paramTypes = globalThis.__param || [];
      if (paramTypes.length > 0) {
        defineMetadata("design:paramtypes", paramTypes, target);
      }
    }
    let result = target;
    for (let i = decorators.length - 1;i >= 0; i--) {
      const decorator = decorators[i];
      if (decorator) {
        if (typeof decorator === "function") {
          if (arguments.length === 2) {
            result = decorator(result) || result;
          } else {
            result = decorator(target, propertyKey, descriptor3) || descriptor3;
          }
        }
      }
    }
    return result;
  };
}
if (!globalThis.Reflect || !globalThis.Reflect.metadata) {
  const globalMetadataStorage = new WeakMap;
  const reflectPolyfill = {
    metadata: (key, value6) => {
      return function(target) {
        if (!globalMetadataStorage.has(target)) {
          globalMetadataStorage.set(target, new Map);
        }
        globalMetadataStorage.get(target).set(key, value6);
      };
    },
    getMetadata: (key, target) => {
      const metadata = globalMetadataStorage.get(target);
      return metadata ? metadata.get(key) : undefined;
    },
    defineMetadata: (key, value6, target) => {
      if (!globalMetadataStorage.has(target)) {
        globalMetadataStorage.set(target, new Map);
      }
      globalMetadataStorage.get(target).set(key, value6);
    }
  };
  if (!globalThis.Reflect) {
    globalThis.Reflect = reflectPolyfill;
  } else {
    Object.assign(globalThis.Reflect, reflectPolyfill);
  }
}
function getConstructorParamTypes(target) {
  let types;
  try {
    types = globalThis.Reflect?.getMetadata?.("design:paramtypes", target);
    if (types && Array.isArray(types) && types.length > 0) {
      const serviceTypes = types.filter((type2) => {
        if (!type2 || type2 === Object || type2 === String || type2 === Number || type2 === Boolean) {
          return false;
        }
        const typeName = type2.name;
        if (typeName && (typeName.toLowerCase().includes("logger") || typeName.toLowerCase().includes("config"))) {
          return false;
        }
        return true;
      });
      return serviceTypes.length > 0 ? serviceTypes : undefined;
    }
  } catch (e) {}
  types = getMetadata("design:paramtypes", target);
  if (types && Array.isArray(types)) {
    const serviceTypes = types.filter((type2) => {
      if (!type2 || type2 === Object || type2 === String || type2 === Number || type2 === Boolean) {
        return false;
      }
      const typeName = type2.name;
      if (typeName && (typeName.toLowerCase().includes("logger") || typeName.toLowerCase().includes("config"))) {
        return false;
      }
      return true;
    });
    return serviceTypes.length > 0 ? serviceTypes : undefined;
  }
  return;
}
var Reflect2 = {
  defineMetadata,
  getMetadata,
  getConstructorParamTypes,
  setConstructorParamTypes
};

// packages/core/src/decorators.ts
var META_CONTROLLERS = new Map;
var META_CONSTRUCTOR_PARAMS = new Map;
function autoDetectDependencies(target, availableServices) {
  const designTypes = getConstructorParamTypes(target);
  if (designTypes && designTypes.length > 0) {
    return designTypes;
  }
  const constructorStr = target.toString();
  const constructorMatch = constructorStr.match(/constructor\s*\(([^)]*)\)/);
  if (!constructorMatch || !constructorMatch[1]) {
    return [];
  }
  const paramsStr = constructorMatch[1];
  const params = paramsStr.split(",").map((p) => p.trim());
  const dependencies = [];
  for (const param of params) {
    if (param.includes("logger") || param.includes("config")) {
      continue;
    }
    const typeMatch = param.match(/:\s*([A-Za-z][A-Za-z0-9]*)/);
    if (typeMatch) {
      const typeName = typeMatch[1];
      const serviceType = availableServices.get(typeName);
      if (serviceType) {
        dependencies.push(serviceType);
      }
    } else {
      const paramNameMatch = param.match(/([a-zA-Z][a-zA-Z0-9]*)/);
      if (paramNameMatch) {
        const paramName = paramNameMatch[1];
        const guessedTypeName = paramName.replace(/Service$/, "").replace(/^[a-z]/, (c) => c.toUpperCase()) + "Service";
        const serviceType = availableServices.get(guessedTypeName);
        if (serviceType) {
          dependencies.push(serviceType);
        }
      }
    }
  }
  return dependencies;
}
function registerControllerDependencies(target, availableServices) {
  const dependencies = autoDetectDependencies(target, availableServices);
  if (dependencies.length > 0) {
    META_CONSTRUCTOR_PARAMS.set(target, dependencies);
  }
}
function getConstructorParamTypes2(target) {
  return META_CONSTRUCTOR_PARAMS.get(target);
}
var PARAMS_METADATA = "onebun:params";
var MIDDLEWARE_METADATA = "onebun:middleware";
function createRouteDecorator(method) {
  return function(path = "") {
    return function(target, propertyKey, descriptor3) {
      const controllerClass = target.constructor;
      let metadata = META_CONTROLLERS.get(controllerClass);
      if (!metadata) {
        metadata = {
          path: "/",
          routes: []
        };
      }
      const routePath = path.startsWith("/") ? path : `/${path}`;
      const params = Reflect2.getMetadata(PARAMS_METADATA, target, propertyKey) || [];
      const middleware = Reflect2.getMetadata(MIDDLEWARE_METADATA, target, propertyKey) || [];
      metadata.routes.push({
        path: routePath,
        method,
        handler: propertyKey,
        params,
        middleware
      });
      META_CONTROLLERS.set(controllerClass, metadata);
      return descriptor3;
    };
  };
}
function createParamDecorator(type2) {
  return function(name, options = {}) {
    return function(target, propertyKey, parameterIndex) {
      const params = Reflect2.getMetadata(PARAMS_METADATA, target, propertyKey) || [];
      params.push({
        type: type2,
        name: name || "",
        index: parameterIndex,
        isRequired: options.required,
        validator: options.validator
      });
      Reflect2.defineMetadata(PARAMS_METADATA, params, target, propertyKey);
    };
  };
}
var Param = createParamDecorator("path" /* PATH */);
var Query = createParamDecorator("query" /* QUERY */);
var Body = createParamDecorator("body" /* BODY */);
var Header = createParamDecorator("header" /* HEADER */);
var Req = createParamDecorator("request" /* REQUEST */);
var Res = createParamDecorator("response" /* RESPONSE */);
var Get = createRouteDecorator("GET" /* GET */);
var Post = createRouteDecorator("POST" /* POST */);
var Put = createRouteDecorator("PUT" /* PUT */);
var Delete = createRouteDecorator("DELETE" /* DELETE */);
var Patch = createRouteDecorator("PATCH" /* PATCH */);
var Options = createRouteDecorator("OPTIONS" /* OPTIONS */);
var Head = createRouteDecorator("HEAD" /* HEAD */);
var All2 = createRouteDecorator("ALL" /* ALL */);
var META_MODULES = new Map;
function getModuleMetadata(target) {
  const metadata = META_MODULES.get(target);
  return metadata;
}

// packages/core/src/module.ts
init_esm();
init_service();

// packages/logger/src/logger.ts
init_esm();

// packages/logger/src/transport.ts
init_esm();
class ConsoleTransport {
  log(formattedEntry, entry) {
    return exports_Effect.sync(() => {
      switch (entry.level) {
        case 50 /* Error */:
        case 60 /* Fatal */:
          console.error(formattedEntry);
          break;
        case 40 /* Warning */:
          console.warn(formattedEntry);
          break;
        case 30 /* Info */:
          console.info(formattedEntry);
          break;
        case 20 /* Debug */:
        case 10 /* Trace */:
        default:
          console.log(formattedEntry);
      }
    });
  }
}

// packages/logger/src/formatter.ts
var COLORS = {
  [10 /* Trace */]: "\x1B[90m",
  [20 /* Debug */]: "\x1B[36m",
  [30 /* Info */]: "\x1B[32m",
  [40 /* Warning */]: "\x1B[33m",
  [50 /* Error */]: "\x1B[31m",
  [60 /* Fatal */]: "\x1B[35m",
  RESET: "\x1B[0m",
  DIM: "\x1B[2m",
  BRIGHT: "\x1B[1m"
};
function formatValue(value6, depth = 0) {
  if (value6 === null)
    return "\x1B[90mnull\x1B[0m";
  if (value6 === undefined)
    return "\x1B[90mundefined\x1B[0m";
  if (typeof value6 === "string") {
    return `\x1B[32m"${value6}"\x1B[0m`;
  }
  if (typeof value6 === "number") {
    return `\x1B[33m${value6}\x1B[0m`;
  }
  if (typeof value6 === "boolean") {
    return `\x1B[35m${value6}\x1B[0m`;
  }
  if (value6 instanceof Date) {
    return `\x1B[36m${value6.toISOString()}\x1B[0m`;
  }
  if (value6 instanceof Error) {
    return `\x1B[31m${value6.name}: ${value6.message}\x1B[0m`;
  }
  if (Array.isArray(value6)) {
    if (depth > 3)
      return "\x1B[90m[Array]\x1B[0m";
    const items = value6.map((item) => formatValue(item, depth + 1));
    if (items.length === 0)
      return "\x1B[90m[]\x1B[0m";
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    return `\x1B[90m[\x1B[0m
${indent}${items.join(`,
${indent}`)}
${closeIndent}\x1B[90m]\x1B[0m`;
  }
  if (typeof value6 === "object") {
    if (depth > 3)
      return "\x1B[90m[Object]\x1B[0m";
    const entries3 = Object.entries(value6);
    if (entries3.length === 0)
      return "\x1B[90m{}\x1B[0m";
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    const formattedEntries = entries3.map(([key, val]) => {
      const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `\x1B[34m${key}\x1B[0m` : `\x1B[32m"${key}"\x1B[0m`;
      return `${formattedKey}: ${formatValue(val, depth + 1)}`;
    });
    return `\x1B[90m{\x1B[0m
${indent}${formattedEntries.join(`,
${indent}`)}
${closeIndent}\x1B[90m}\x1B[0m`;
  }
  if (typeof value6 === "function") {
    return `\x1B[36m[Function: ${value6.name || "anonymous"}]\x1B[0m`;
  }
  return String(value6);
}

class PrettyFormatter {
  format(entry) {
    const time2 = entry.timestamp.toISOString();
    const level = this.getLevelName(entry.level).padEnd(7);
    const color = COLORS[entry.level.toString()] || "";
    const reset2 = COLORS.RESET;
    const traceInfo = entry.trace ? ` [trace:${entry.trace.traceId.slice(-8)} span:${entry.trace.spanId.slice(-8)}]` : "";
    let className = "";
    let contextWithoutClassName = {};
    if (entry.context) {
      const { className: extractedClassName, ...restContext } = entry.context;
      if (extractedClassName && typeof extractedClassName === "string") {
        className = ` [${extractedClassName}]`;
      }
      contextWithoutClassName = restContext;
    }
    let message = `${color}${time2} [${level}]${reset2}${traceInfo}${className} ${entry.message}`;
    if (contextWithoutClassName.__additionalData) {
      const additionalData = contextWithoutClassName.__additionalData;
      if (additionalData.length > 0) {
        const formattedData = additionalData.map((data) => formatValue(data)).join(" ");
        message += ` ${formattedData}`;
      }
      delete contextWithoutClassName.__additionalData;
    }
    if (Object.keys(contextWithoutClassName).length > 0) {
      const contextWithoutSpecialFields = { ...contextWithoutClassName };
      delete contextWithoutSpecialFields.SHOW_CONTEXT;
      if (Object.keys(contextWithoutSpecialFields).length > 0) {
        message += `
${COLORS.DIM}Context:${COLORS.RESET} ${formatValue(contextWithoutSpecialFields)}`;
      }
    }
    if (entry.error) {
      message += `
${COLORS[50 /* Error */]}Error:${COLORS.RESET} ${entry.error.stack || entry.error.message}`;
    }
    return message;
  }
  getLevelName(level) {
    switch (level) {
      case 10 /* Trace */:
        return "TRACE";
      case 20 /* Debug */:
        return "DEBUG";
      case 30 /* Info */:
        return "INFO";
      case 40 /* Warning */:
        return "WARN";
      case 50 /* Error */:
        return "ERROR";
      case 60 /* Fatal */:
        return "FATAL";
      default:
        return "UNKNOWN";
    }
  }
}

class JsonFormatter {
  format(entry) {
    const logData = {
      timestamp: entry.timestamp.toISOString(),
      level: this.getLevelName(entry.level),
      message: entry.message
    };
    if (entry.trace) {
      logData.trace = {
        traceId: entry.trace.traceId,
        spanId: entry.trace.spanId,
        ...entry.trace.parentSpanId ? { parentSpanId: entry.trace.parentSpanId } : {}
      };
    }
    if (entry.context) {
      const contextData = { ...entry.context };
      if (contextData.__additionalData) {
        logData.additionalData = contextData.__additionalData;
        delete contextData.__additionalData;
      }
      if (Object.keys(contextData).length > 0) {
        logData.context = contextData;
      }
    }
    if (entry.error) {
      logData.error = {
        message: entry.error.message,
        stack: entry.error.stack,
        name: entry.error.name
      };
    }
    return JSON.stringify(logData);
  }
  getLevelName(level) {
    switch (level) {
      case 10 /* Trace */:
        return "trace";
      case 20 /* Debug */:
        return "debug";
      case 30 /* Info */:
        return "info";
      case 40 /* Warning */:
        return "warn";
      case 50 /* Error */:
        return "error";
      case 60 /* Fatal */:
        return "fatal";
      default:
        return "unknown";
    }
  }
}

// packages/logger/src/logger.ts
var LoggerService = exports_Context.GenericTag("LoggerService");
var CurrentLoggerTraceContext = exports_FiberRef.unsafeMake(null);
function parseLogArgs(args2) {
  if (args2.length === 0) {
    return {};
  }
  let error2;
  let context9;
  const additionalData = [];
  for (const arg of args2) {
    if (arg instanceof Error) {
      if (!error2) {
        error2 = arg;
      } else {
        additionalData.push(arg);
      }
    } else if (arg && typeof arg === "object" && !Array.isArray(arg) && arg.constructor === Object) {
      context9 = { ...context9, ...arg };
    } else {
      additionalData.push(arg);
    }
  }
  return {
    error: error2,
    context: Object.keys(context9 || {}).length > 0 ? context9 : undefined,
    additionalData: additionalData.length > 0 ? additionalData : undefined
  };
}

class LoggerImpl {
  config;
  context;
  constructor(config2, context9 = {}) {
    this.config = config2;
    this.context = context9;
  }
  log(level, message, ...args2) {
    if (level < this.config.minLevel) {
      return exports_Effect.succeed(undefined);
    }
    return exports_Effect.flatMap(exports_FiberRef.get(CurrentLoggerTraceContext), (traceInfo) => {
      let currentTraceInfo = traceInfo;
      if (!currentTraceInfo && typeof globalThis !== "undefined") {
        const globalTraceContext = globalThis.__onebunCurrentTraceContext;
        if (globalTraceContext && globalTraceContext.traceId) {
          currentTraceInfo = globalTraceContext;
        } else {
          const globalTraceService = globalThis.__onebunTraceService;
          if (globalTraceService && globalTraceService.getCurrentTraceContext) {
            try {
              const currentContext3 = exports_Effect.runSync(globalTraceService.getCurrentTraceContext());
              if (currentContext3 && currentContext3.traceId) {
                currentTraceInfo = {
                  traceId: currentContext3.traceId,
                  spanId: currentContext3.spanId,
                  parentSpanId: currentContext3.parentSpanId
                };
              }
            } catch (error3) {}
          }
        }
      }
      const { error: error2, context: argsContext, additionalData } = parseLogArgs(args2);
      const mergedContext = {
        ...this.config.defaultContext,
        ...this.context,
        ...argsContext
      };
      if (additionalData && additionalData.length > 0) {
        mergedContext.__additionalData = additionalData;
      }
      const entry = {
        level,
        message,
        timestamp: new Date,
        context: Object.keys(mergedContext).length > 0 ? mergedContext : undefined,
        error: error2,
        trace: currentTraceInfo || undefined
      };
      const formattedEntry = this.config.formatter.format(entry);
      return this.config.transport.log(formattedEntry, entry);
    });
  }
  trace(message, ...args2) {
    return this.log(10 /* Trace */, message, ...args2);
  }
  debug(message, ...args2) {
    return this.log(20 /* Debug */, message, ...args2);
  }
  info(message, ...args2) {
    return this.log(30 /* Info */, message, ...args2);
  }
  warn(message, ...args2) {
    return this.log(40 /* Warning */, message, ...args2);
  }
  error(message, ...args2) {
    return this.log(50 /* Error */, message, ...args2);
  }
  fatal(message, ...args2) {
    return this.log(60 /* Fatal */, message, ...args2);
  }
  child(context9) {
    return new LoggerImpl(this.config, { ...this.context, ...context9 });
  }
}
var makeDevLogger = (config2) => {
  return exports_Layer.succeed(LoggerService, new LoggerImpl({
    minLevel: 20 /* Debug */,
    formatter: new PrettyFormatter,
    transport: new ConsoleTransport,
    defaultContext: {},
    ...config2
  }));
};
var makeProdLogger = (config2) => {
  return exports_Layer.succeed(LoggerService, new LoggerImpl({
    minLevel: 30 /* Info */,
    formatter: new JsonFormatter,
    transport: new ConsoleTransport,
    defaultContext: {},
    ...config2
  }));
};

class SyncLoggerImpl {
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  runWithTraceContext(effect4) {
    let traceEffect = effect4;
    if (typeof globalThis !== "undefined") {
      const globalTraceContext = globalThis.__onebunCurrentTraceContext;
      if (globalTraceContext && globalTraceContext.traceId) {
        traceEffect = exports_Effect.provide(exports_Effect.flatMap(exports_FiberRef.set(CurrentLoggerTraceContext, globalTraceContext), () => effect4), exports_Layer.empty);
      }
    }
    return exports_Effect.runSync(traceEffect);
  }
  trace(message, ...args2) {
    this.runWithTraceContext(this.logger.trace(message, ...args2));
  }
  debug(message, ...args2) {
    this.runWithTraceContext(this.logger.debug(message, ...args2));
  }
  info(message, ...args2) {
    this.runWithTraceContext(this.logger.info(message, ...args2));
  }
  warn(message, ...args2) {
    this.runWithTraceContext(this.logger.warn(message, ...args2));
  }
  error(message, ...args2) {
    this.runWithTraceContext(this.logger.error(message, ...args2));
  }
  fatal(message, ...args2) {
    this.runWithTraceContext(this.logger.fatal(message, ...args2));
  }
  child(context9) {
    return new SyncLoggerImpl(this.logger.child(context9));
  }
}
var createSyncLogger = (logger) => {
  return new SyncLoggerImpl(logger);
};
var makeLogger2 = (config2) => {
  const isDev = true;
  return isDev ? makeDevLogger(config2) : makeProdLogger(config2);
};
// packages/core/src/module.ts
class OneBunModule {
  moduleClass;
  loggerLayer;
  rootLayer;
  controllers = [];
  controllerInstances = new Map;
  serviceInstances = new Map;
  logger;
  config;
  constructor(moduleClass, loggerLayer, config2) {
    this.moduleClass = moduleClass;
    this.loggerLayer = loggerLayer;
    const effectLogger = exports_Effect.runSync(exports_Effect.provide(exports_Effect.map(LoggerService, (logger2) => logger2.child({ className: `OneBunModule:${moduleClass.name}` })), this.loggerLayer || makeLogger2()));
    this.logger = createSyncLogger(effectLogger);
    this.config = config2;
    this.logger.debug(`Initializing OneBunModule for ${moduleClass.name}`);
    const { layer, controllers } = this.initModule();
    this.rootLayer = layer;
    this.controllers = controllers;
    this.logger.debug(`OneBunModule initialized for ${moduleClass.name}, controllers: ${controllers.length}`);
  }
  initModule() {
    this.logger.debug(`Initializing module metadata for ${this.moduleClass.name}`);
    const metadata = getModuleMetadata(this.moduleClass);
    if (!metadata) {
      this.logger.error(`Module ${this.moduleClass.name} does not have @Module decorator`);
      throw new Error(`Module ${this.moduleClass.name} does not have @Module decorator`);
    }
    this.logger.debug(`Found module metadata for ${this.moduleClass.name}`);
    let layer = this.loggerLayer || makeLogger2();
    const controllers = [];
    const serviceLayers = [];
    if (metadata.controllers) {
      for (const controller of metadata.controllers) {
        controllers.push(controller);
      }
    }
    if (metadata.providers) {
      for (const provider of metadata.providers) {
        if (typeof provider === "function") {
          this.logger.debug(`Checking if provider ${provider.name} has @Service decorator`);
          const serviceMetadata = getServiceMetadata(provider);
          if (serviceMetadata) {
            this.logger.debug(`Provider ${provider.name} has @Service decorator, creating service layer`);
            const serviceLayer = createServiceLayer(provider, this.logger, this.config);
            serviceLayers.push(serviceLayer);
            layer = exports_Layer.merge(layer, serviceLayer);
            this.logger.debug(`Added service layer for ${provider.name}`);
            continue;
          } else {
            this.logger.warn(`Provider ${provider.name} does not have @Service decorator`);
          }
        }
        if (typeof provider === "object" && provider !== null && "prototype" in provider && "tag" in provider) {
          const tagProvider = provider;
          const impl = metadata.providers.find((p) => tagProvider.isTag && typeof p === "function" && typeof tagProvider.Service === "function" && ("prototype" in p) && p.prototype instanceof tagProvider.Service);
          if (impl && typeof impl === "function") {
            const implConstructor = impl;
            const serviceLayer = exports_Layer.succeed(provider, new implConstructor);
            serviceLayers.push(serviceLayer);
            layer = exports_Layer.merge(layer, serviceLayer);
          }
        } else if (typeof provider === "function") {
          try {
            const providerConstructor = provider;
            const instance = new providerConstructor;
            const tag2 = metadata.providers.find((p) => typeof p === "object" && p !== null && ("isTag" in p) && ("Service" in p) && instance instanceof p.Service);
            if (tag2) {
              const serviceLayer = exports_Layer.succeed(tag2, instance);
              serviceLayers.push(serviceLayer);
              layer = exports_Layer.merge(layer, serviceLayer);
            }
          } catch (error2) {
            this.logger.warn(`Failed to auto-create instance of ${provider.name}`);
          }
        }
      }
    }
    if (metadata.imports) {
      for (const importModule of metadata.imports) {
        const childModule = new OneBunModule(importModule, this.loggerLayer, this.config);
        layer = exports_Layer.merge(layer, childModule.getLayer());
        controllers.push(...childModule.getControllers());
      }
    }
    return { layer, controllers };
  }
  createControllerInstances() {
    const self = this;
    return exports_Effect.gen(function* (_) {
      const services = yield* _(exports_Effect.context());
      for (const [key, value6] of Object.entries(services)) {
        if (key && value6 && typeof key === "object" && "Identifier" in key) {
          const tag2 = key;
          self.serviceInstances.set(tag2, value6);
        }
      }
      const moduleMetadata = getModuleMetadata(self.moduleClass);
      if (moduleMetadata && moduleMetadata.providers) {
        const { getServiceTag: getServiceTag2 } = (init_service(), __toCommonJS(exports_service));
        const availableServices = new Map;
        for (const provider of moduleMetadata.providers) {
          if (typeof provider === "function") {
            availableServices.set(provider.name, provider);
            try {
              const tag2 = getServiceTag2(provider);
              let found = false;
              for (const [key, value6] of Object.entries(services)) {
                if (key && value6 && typeof key === "object" && "Identifier" in key) {
                  if (key === tag2 || key.Identifier === tag2.Identifier) {
                    self.serviceInstances.set(tag2, value6);
                    found = true;
                    break;
                  }
                }
              }
              if (!found) {
                const ServiceConstructor = provider;
                const serviceInstance = new ServiceConstructor(self.logger, self.config);
                self.serviceInstances.set(tag2, serviceInstance);
              }
            } catch (error2) {
              self.logger.warn(`Failed to get service tag for provider ${provider.name}: ${error2}`);
            }
          }
        }
        for (const ControllerClass of self.controllers) {
          registerControllerDependencies(ControllerClass, availableServices);
        }
      }
      self.createControllersWithDI();
    }).pipe(exports_Effect.provide(this.rootLayer));
  }
  createControllersWithDI() {
    for (const ControllerClass of this.controllers) {
      const paramTypes = getConstructorParamTypes2(ControllerClass);
      const dependencies = [];
      if (paramTypes && paramTypes.length > 0) {
        for (const paramType of paramTypes) {
          const dependency = this.resolveDependencyByType(paramType);
          if (dependency) {
            dependencies.push(dependency);
          } else {
            this.logger.warn(`Could not resolve dependency ${paramType.name} for ${ControllerClass.name}`);
          }
        }
      }
      dependencies.push(this.logger);
      dependencies.push(this.config);
      const ControllerConstructor = ControllerClass;
      const controller = new ControllerConstructor(...dependencies);
      this.controllerInstances.set(ControllerClass, controller);
      for (const [tag2, serviceInstance] of this.serviceInstances.entries()) {
        controller.setService(tag2, serviceInstance);
      }
      if (paramTypes && paramTypes.length > 0) {
        this.logger.debug(`Controller ${ControllerClass.name} created with ${paramTypes.length} injected dependencies`);
      }
    }
  }
  resolveDependencyByName(typeName) {
    return null;
  }
  resolveDependencyByType(type2) {
    const serviceInstance = Array.from(this.serviceInstances.values()).find((instance) => {
      if (!instance)
        return false;
      return instance.constructor === type2 || instance instanceof type2;
    });
    return serviceInstance;
  }
  setup() {
    return this.createControllerInstances();
  }
  getControllers() {
    return this.controllers;
  }
  getControllerInstance(controllerClass) {
    const instance = this.controllerInstances.get(controllerClass);
    if (!instance) {
      this.logger.warn(`No instance found for controller ${controllerClass.name}`);
    }
    return instance;
  }
  getControllerInstances() {
    return this.controllerInstances;
  }
  getServiceInstance(tag2) {
    return this.serviceInstances.get(tag2);
  }
  getLayer() {
    return this.rootLayer;
  }
  static create(moduleClass, loggerLayer, config2) {
    return new OneBunModule(moduleClass, loggerLayer, config2);
  }
}

// packages/envs/src/types.ts
class EnvValidationError extends Error {
  variable;
  value;
  reason;
  constructor(variable, value6, reason) {
    super(`Environment variable validation failed for "${variable}": ${reason}. Got: ${value6}`);
    this.variable = variable;
    this.value = value6;
    this.reason = reason;
    this.name = "EnvValidationError";
  }
}

class EnvLoadError extends Error {
  variable;
  reason;
  constructor(variable, reason) {
    super(`Failed to load environment variable "${variable}": ${reason}`);
    this.variable = variable;
    this.reason = reason;
    this.name = "EnvLoadError";
  }
}
// packages/envs/src/parser.ts
init_esm();
class EnvParser {
  static parse(variable, value6, config2, options = {}) {
    const resolveValue = exports_Effect.sync(() => {
      if (value6 === undefined) {
        if (config2.default !== undefined) {
          return config2.default;
        }
        if (config2.required) {
          throw new EnvValidationError(variable, value6, "Required variable is not set");
        }
        return EnvParser.getDefaultForTypeSync(config2.type);
      }
      return value6;
    });
    const parseValue = (resolvedValue) => {
      if (typeof resolvedValue === "string") {
        const separator = config2.separator || options.defaultArraySeparator || ",";
        return EnvParser.parseByType(variable, resolvedValue, config2.type, separator);
      }
      return exports_Effect.succeed(resolvedValue);
    };
    const validateParsed = (parsed) => EnvParser.validateValue(variable, parsed, config2);
    return resolveValue.pipe(exports_Effect.flatMap(parseValue), exports_Effect.flatMap(validateParsed));
  }
  static parseByType(variable, value6, type2, separator = ",") {
    return exports_Effect.try({
      try: () => {
        switch (type2) {
          case "string":
            return value6;
          case "number": {
            const num = Number(value6);
            if (isNaN(num)) {
              throw new Error(`"${value6}" is not a valid number`);
            }
            return num;
          }
          case "boolean": {
            const lower = value6.toLowerCase();
            if (["true", "1", "yes", "on"].includes(lower))
              return true;
            if (["false", "0", "no", "off"].includes(lower))
              return false;
            throw new Error(`"${value6}" is not a valid boolean`);
          }
          case "array": {
            if (value6.trim() === "")
              return [];
            return value6.split(separator).map((item) => item.trim());
          }
          default:
            throw new Error(`Unknown type: ${type2}`);
        }
      },
      catch: (error2) => new EnvValidationError(variable, value6, error2 instanceof Error ? error2.message : String(error2))
    });
  }
  static validateValue(variable, value6, config2) {
    if (config2.validate) {
      return config2.validate(value6);
    }
    return exports_Effect.succeed(value6);
  }
  static getDefaultForTypeSync(type2) {
    switch (type2) {
      case "string":
        return "";
      case "number":
        return 0;
      case "boolean":
        return false;
      case "array":
        return [];
      default:
        throw new EnvValidationError("unknown", undefined, `Unknown type: ${type2}`);
    }
  }
  static getDefaultForType(type2) {
    switch (type2) {
      case "string":
        return exports_Effect.succeed("");
      case "number":
        return exports_Effect.succeed(0);
      case "boolean":
        return exports_Effect.succeed(false);
      case "array":
        return exports_Effect.succeed([]);
      default:
        return exports_Effect.fail(new EnvValidationError("unknown", undefined, `Unknown type: ${type2}`));
    }
  }
}
// packages/envs/src/loader.ts
init_esm();
class EnvLoader {
  static load(options = {}) {
    const {
      envFilePath = ".env",
      loadDotEnv = true,
      envOverridesDotEnv = true
    } = options;
    const loadDotEnvVars = loadDotEnv ? EnvLoader.loadDotEnvFile(envFilePath) : exports_Effect.succeed({});
    const processEnvVars = EnvLoader.loadProcessEnv();
    return loadDotEnvVars.pipe(exports_Effect.map((dotEnvVars) => {
      if (envOverridesDotEnv) {
        return { ...dotEnvVars, ...processEnvVars };
      } else {
        return { ...processEnvVars, ...dotEnvVars };
      }
    }));
  }
  static loadDotEnvFile(filePath) {
    return exports_Effect.tryPromise({
      try: async () => {
        const file = Bun.file(filePath);
        const exists5 = await file.exists();
        if (!exists5) {
          return {};
        }
        const content = await file.text();
        return EnvLoader.parseDotEnvContent(content);
      },
      catch: (error2) => new EnvLoadError(filePath, `Failed to read .env file: ${error2 instanceof Error ? error2.message : String(error2)}`)
    });
  }
  static parseDotEnvContent(content) {
    const variables = {};
    const lines = content.split(`
`);
    for (let i = 0;i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const equalIndex = line.indexOf("=");
      if (equalIndex === -1) {
        continue;
      }
      const key = line.slice(0, equalIndex).trim();
      let value6 = line.slice(equalIndex + 1).trim();
      if (value6.startsWith('"') && value6.endsWith('"') || value6.startsWith("'") && value6.endsWith("'")) {
        value6 = value6.slice(1, -1);
      }
      value6 = value6.replace(/\\n/g, `
`).replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\'/g, "'");
      variables[key] = value6;
    }
    return variables;
  }
  static loadProcessEnv() {
    const variables = {};
    for (const [key, value6] of Object.entries(process.env)) {
      if (value6 !== undefined) {
        variables[key] = value6;
      }
    }
    return variables;
  }
  static checkDotEnvExists(filePath = ".env") {
    return exports_Effect.promise(() => Bun.file(filePath).exists());
  }
}
// packages/envs/src/typed-env.ts
init_esm();
class SensitiveValue {
  _value;
  constructor(_value) {
    this._value = _value;
  }
  get value() {
    return this._value;
  }
  toString() {
    return "***";
  }
  toJSON() {
    return "***";
  }
  valueOf() {
    return this._value;
  }
  [Symbol.toPrimitive](hint) {
    if (hint === "string")
      return "***";
    if (hint === "number" && typeof this._value === "number")
      return this._value;
    return this._value;
  }
}

class ConfigProxy {
  _schema;
  _options;
  _isInitialized = false;
  _values = null;
  _sensitiveFields = new Set;
  constructor(_schema, _options = {}) {
    this._schema = _schema;
    this._options = _options;
    this.extractSensitiveFields(this._schema, "");
  }
  extractSensitiveFields(schema, prefix = "") {
    for (const [key, config2] of Object.entries(schema)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      if (this.isEnvVariableConfig(config2)) {
        if (config2.sensitive) {
          this._sensitiveFields.add(fullPath);
        }
      } else {
        this.extractSensitiveFields(config2, fullPath);
      }
    }
  }
  isEnvVariableConfig(config2) {
    return config2 && typeof config2 === "object" && "type" in config2;
  }
  async ensureInitialized() {
    if (this._isInitialized)
      return;
    const rawVariables = await exports_Effect.runPromise(EnvLoader.load(this._options));
    this._values = this.parseNestedSchema(this._schema, rawVariables, "");
    this._isInitialized = true;
  }
  parseNestedSchema(schema, rawVariables, prefix) {
    const result = {};
    for (const [key, config2] of Object.entries(schema)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      if (this.isEnvVariableConfig(config2)) {
        const envConfig = config2;
        const envVar = envConfig.env || this.pathToEnvVar(fullPath);
        const rawValue = rawVariables[envVar];
        try {
          const parsed = exports_Effect.runSync(EnvParser.parse(envVar, rawValue, envConfig, this._options));
          result[key] = parsed;
        } catch (error2) {
          if (error2 instanceof EnvValidationError) {
            throw error2;
          }
          throw new EnvValidationError(envVar, rawValue, String(error2));
        }
      } else {
        result[key] = this.parseNestedSchema(config2, rawVariables, fullPath);
      }
    }
    return result;
  }
  pathToEnvVar(path) {
    return path.toUpperCase().replace(/\./g, "_");
  }
  getValueByPath(obj, path) {
    const keys9 = path.split(".");
    let current2 = obj;
    for (const key of keys9) {
      if (current2 && typeof current2 === "object" && key in current2) {
        current2 = current2[key];
      } else {
        return;
      }
    }
    return current2;
  }
  get(path) {
    if (!this._isInitialized || !this._values) {
      throw new Error("Configuration not initialized. Call TypedEnv.create() or ensure initialization is complete.");
    }
    const value6 = this.getValueByPath(this._values, path);
    if (this._sensitiveFields.has(path)) {
      return new SensitiveValue(value6);
    }
    return value6;
  }
  get values() {
    if (!this._isInitialized || !this._values) {
      throw new Error("Configuration not initialized. Call TypedEnv.create() or ensure initialization is complete.");
    }
    return this._values;
  }
  async initialize() {
    await this.ensureInitialized();
  }
  get isInitialized() {
    return this._isInitialized;
  }
  getSafeConfig() {
    if (!this._isInitialized || !this._values) {
      throw new Error("Configuration not initialized.");
    }
    return this.applySensitiveMask(this._values, "");
  }
  applySensitiveMask(obj, prefix = "") {
    if (obj === null || obj === undefined)
      return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => typeof item === "object" ? this.applySensitiveMask(item, prefix) : item);
    }
    if (typeof obj === "object") {
      const result = {};
      for (const [key, value6] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        if (this._sensitiveFields.has(fullPath)) {
          result[key] = "***";
        } else if (value6 && typeof value6 === "object") {
          result[key] = this.applySensitiveMask(value6, fullPath);
        } else {
          result[key] = value6;
        }
      }
      return result;
    }
    return obj;
  }
}

class TypedEnv {
  static instances = new Map;
  static create(schema, options = {}, key = "default") {
    if (!TypedEnv.instances.has(key)) {
      const proxy = new ConfigProxy(schema, options);
      TypedEnv.instances.set(key, proxy);
      proxy.initialize();
    }
    return TypedEnv.instances.get(key);
  }
  static async createAsync(schema, options = {}, key = "default") {
    const proxy = TypedEnv.create(schema, options, key);
    await proxy.initialize();
    return proxy;
  }
  static clear() {
    TypedEnv.instances.clear();
  }
}
// packages/envs/src/helpers.ts
init_esm();

// packages/envs/src/index.ts
init_esm();

// packages/core/src/config.service.ts
init_esm();
init_service();
var ConfigServiceTag = exports_Context.GenericTag("ConfigService");

class ConfigServiceImpl extends BaseService {
  configInstance = null;
  constructor(logger2, config2) {
    super(logger2);
    this.configInstance = config2;
  }
  async initialize() {
    if (this.configInstance) {
      await this.configInstance.initialize();
      this.logger.info("Configuration initialized successfully");
    }
  }
  get(path) {
    if (!this.configInstance) {
      throw new Error("Configuration not initialized. Provide envSchema in ApplicationOptions.");
    }
    return this.configInstance.get(path);
  }
  get values() {
    if (!this.configInstance) {
      throw new Error("Configuration not initialized. Provide envSchema in ApplicationOptions.");
    }
    return this.configInstance.values;
  }
  getSafeConfig() {
    if (!this.configInstance) {
      throw new Error("Configuration not initialized. Provide envSchema in ApplicationOptions.");
    }
    return this.configInstance.getSafeConfig();
  }
  get isInitialized() {
    return this.configInstance ? this.configInstance.isInitialized : false;
  }
  get instance() {
    return this.configInstance;
  }
}
ConfigServiceImpl = __legacyDecorateClassTS([
  Service2(ConfigServiceTag),
  __legacyMetadataTS("design:paramtypes", [
    Object,
    Object
  ])
], ConfigServiceImpl);
// packages/trace/src/trace.service.ts
init_esm();
var import_api = __toESM(require_src(), 1);
var TraceService = exports_Context.GenericTag("@onebun/trace/TraceService");
var CurrentTraceContext = exports_FiberRef.unsafeMake(null);
var CurrentSpan = exports_FiberRef.unsafeMake(null);

class TraceServiceImpl {
  tracer = import_api.trace.getTracer("@onebun/trace");
  options;
  constructor(options = {}) {
    this.options = {
      enabled: true,
      serviceName: "onebun-service",
      serviceVersion: "1.0.0",
      samplingRate: 1,
      traceHttpRequests: true,
      traceDatabaseQueries: true,
      defaultAttributes: {},
      exportOptions: {},
      ...options
    };
  }
  getCurrentContext() {
    return exports_FiberRef.get(CurrentTraceContext);
  }
  setContext(traceContext) {
    return exports_FiberRef.set(CurrentTraceContext, traceContext);
  }
  startSpan(name, parentContext) {
    if (!this.options.enabled) {
      return exports_Effect.flatMap(this.generateTraceContext(), (context10) => {
        const mockSpan = {
          context: context10,
          name,
          startTime: Date.now(),
          attributes: {},
          events: [],
          status: { code: 1 /* OK */ }
        };
        return exports_Effect.flatMap(exports_FiberRef.set(CurrentSpan, mockSpan), () => exports_Effect.succeed(mockSpan));
      });
    }
    const currentContext3 = import_api.context.active();
    const span4 = this.tracer.startSpan(name, {
      kind: import_api.SpanKind.INTERNAL,
      attributes: this.options.defaultAttributes
    }, currentContext3);
    const spanContext = span4.spanContext();
    const traceContext = {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      parentSpanId: parentContext?.spanId
    };
    const traceSpan = {
      context: traceContext,
      name,
      startTime: Date.now(),
      attributes: { ...this.options.defaultAttributes },
      events: [],
      status: { code: 1 /* OK */ }
    };
    return exports_Effect.flatMap(exports_FiberRef.set(CurrentSpan, traceSpan), () => exports_Effect.flatMap(this.setContext(traceContext), () => exports_Effect.succeed(traceSpan)));
  }
  endSpan(span4, status2) {
    if (!this.options.enabled) {
      return exports_Effect.void;
    }
    span4.endTime = Date.now();
    if (status2) {
      span4.status = status2;
    }
    const activeSpan = import_api.trace.getActiveSpan();
    if (activeSpan && activeSpan.spanContext().spanId === span4.context.spanId) {
      if (status2?.code === 2 /* ERROR */) {
        activeSpan.setStatus({
          code: import_api.SpanStatusCode.ERROR,
          message: status2.message
        });
      }
      activeSpan.end();
    }
    return exports_FiberRef.set(CurrentSpan, null);
  }
  addEvent(name, attributes) {
    if (!this.options.enabled) {
      return exports_Effect.void;
    }
    return exports_Effect.flatMap(exports_FiberRef.get(CurrentSpan), (span4) => {
      if (span4) {
        span4.events.push({
          name,
          timestamp: Date.now(),
          attributes
        });
        const activeSpan = import_api.trace.getActiveSpan();
        if (activeSpan) {
          activeSpan.addEvent(name, attributes);
        }
      }
      return exports_Effect.void;
    });
  }
  setAttributes(attributes) {
    if (!this.options.enabled) {
      return exports_Effect.void;
    }
    return exports_Effect.flatMap(exports_FiberRef.get(CurrentSpan), (span4) => {
      if (span4) {
        Object.assign(span4.attributes, attributes);
        const activeSpan = import_api.trace.getActiveSpan();
        if (activeSpan) {
          activeSpan.setAttributes(attributes);
        }
      }
      return exports_Effect.void;
    });
  }
  extractFromHeaders(headers) {
    if (!this.options.enabled) {
      return exports_Effect.succeed(null);
    }
    const traceparent = headers["traceparent"];
    if (traceparent) {
      const match25 = traceparent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
      if (match25) {
        return exports_Effect.succeed({
          traceId: match25[1],
          spanId: match25[2],
          traceFlags: parseInt(match25[3], 16)
        });
      }
    }
    const traceId = headers["x-trace-id"];
    const spanId = headers["x-span-id"];
    if (traceId && spanId) {
      return exports_Effect.succeed({
        traceId,
        spanId,
        traceFlags: 1
      });
    }
    return exports_Effect.succeed(null);
  }
  injectIntoHeaders(traceContext) {
    return exports_Effect.succeed({
      traceparent: `00-${traceContext.traceId}-${traceContext.spanId}-${traceContext.traceFlags.toString(16).padStart(2, "0")}`,
      "x-trace-id": traceContext.traceId,
      "x-span-id": traceContext.spanId
    });
  }
  generateTraceContext() {
    return exports_Effect.succeed({
      traceId: this.generateId(32),
      spanId: this.generateId(16),
      traceFlags: Math.random() < this.options.samplingRate ? 1 : 0
    });
  }
  startHttpTrace(data) {
    const spanName = `HTTP ${data.method || "REQUEST"} ${data.route || data.url || "/"}`;
    return exports_Effect.flatMap(this.startSpan(spanName), (span4) => {
      const attributes = {
        "http.method": data.method || "UNKNOWN",
        "http.url": data.url || "",
        "http.route": data.route || "",
        "http.user_agent": data.userAgent || "",
        "http.remote_addr": data.remoteAddr || ""
      };
      if (data.requestSize !== undefined) {
        attributes["http.request_content_length"] = data.requestSize;
      }
      return exports_Effect.flatMap(this.setAttributes(attributes), () => exports_Effect.succeed(span4));
    });
  }
  endHttpTrace(span4, data) {
    const attributes = {};
    if (data.statusCode !== undefined) {
      attributes["http.status_code"] = data.statusCode;
    }
    if (data.responseSize !== undefined) {
      attributes["http.response_content_length"] = data.responseSize;
    }
    if (data.duration !== undefined) {
      attributes["http.duration"] = data.duration;
    }
    const status2 = {
      code: data.statusCode && data.statusCode >= 400 ? 2 /* ERROR */ : 1 /* OK */,
      message: data.statusCode && data.statusCode >= 400 ? `HTTP ${data.statusCode}` : undefined
    };
    return exports_Effect.flatMap(this.setAttributes(attributes), () => this.endSpan(span4, status2));
  }
  generateId(length3) {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0;i < length3; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}
var makeTraceService = (options) => exports_Layer.succeed(TraceService, new TraceServiceImpl(options));
var TraceServiceLive = makeTraceService();
// packages/trace/src/middleware.ts
init_esm();
// packages/core/src/application.ts
var MetricsService2;
var createMetricsService2;
var HttpMetricsData;
try {
  const metricsModule = (init_src(), __toCommonJS(exports_src));
  MetricsService2 = metricsModule.MetricsService;
  createMetricsService2 = metricsModule.createMetricsService;
  HttpMetricsData = metricsModule.HttpMetricsData;
} catch (error2) {}
// packages/core/src/controller.ts
class Controller {
  services = new Map;
  logger;
  config;
  constructor(logger2, config2) {
    const className = this.constructor.name;
    if (logger2) {
      this.logger = logger2.child({ className });
    } else {
      throw new Error(`Logger is required for controller ${className}. Make sure OneBunApplication is configured correctly.`);
    }
    this.config = config2;
  }
  getService(tagOrClass) {
    let tag2;
    if (typeof tagOrClass === "function") {
      const { getServiceTag: getServiceTag2 } = (init_service(), __toCommonJS(exports_service));
      tag2 = getServiceTag2(tagOrClass);
    } else {
      tag2 = tagOrClass;
    }
    let service3 = this.services.get(tag2);
    if (!service3 && "Identifier" in tag2) {
      for (const [key, value6] of this.services.entries()) {
        if ("Identifier" in key && key.Identifier === tag2.Identifier) {
          service3 = value6;
          break;
        }
      }
    }
    if (!service3) {
      const id2 = "Identifier" in tag2 ? tag2.Identifier : tagOrClass.name;
      throw new Error(`Service ${id2} not found. Make sure it's registered in the module.`);
    }
    return service3;
  }
  setService(tag2, instance) {
    this.services.set(tag2, instance);
  }
  isJson(req) {
    return req.headers.get("Content-Type")?.includes("application/json") ?? false;
  }
  async parseJson(req) {
    return await req.json();
  }
  success(result, status2 = 200) {
    return new Response(JSON.stringify({ success: true, result }), {
      status: status2,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  error(message, code = 500, status2 = 500) {
    return new Response(JSON.stringify({ success: false, code, message }), {
      status: status2,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  json(data, status2 = 200) {
    return this.success(data, status2);
  }
  text(data, status2 = 200) {
    return new Response(data, {
      status: status2,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
}

// packages/core/src/index.ts
init_service();
init_esm();

// packages/requests/src/types.ts
var DEFAULT_RETRY_CONFIG = {
  max: 3,
  delay: 1000,
  backoff: "exponential",
  factor: 2,
  retryOn: [408, 429, 500, 502, 503, 504]
};
var DEFAULT_REQUESTS_OPTIONS = {
  timeout: 1e4,
  headers: {},
  retries: DEFAULT_RETRY_CONFIG,
  tracing: true,
  metrics: true,
  userAgent: "OneBun-Requests/1.0"
};
// packages/requests/src/auth.ts
init_esm();
var applyAuth = (auth, config3) => {
  switch (auth.type) {
    case "bearer":
      return exports_Effect.succeed({
        ...config3,
        headers: {
          ...config3.headers,
          Authorization: `Bearer ${auth.token}`
        }
      });
    case "apikey":
      if (auth.location === "query") {
        return exports_Effect.succeed({
          ...config3,
          query: {
            ...config3.query,
            [auth.key]: auth.value
          }
        });
      } else {
        return exports_Effect.succeed({
          ...config3,
          headers: {
            ...config3.headers,
            [auth.key]: auth.value
          }
        });
      }
    case "basic":
      const credentials = btoa(`${auth.username}:${auth.password}`);
      return exports_Effect.succeed({
        ...config3,
        headers: {
          ...config3.headers,
          Authorization: `Basic ${credentials}`
        }
      });
    case "custom":
      return pipe(exports_Effect.succeed({ ...config3 }), exports_Effect.map((updatedConfig) => {
        if (auth.headers) {
          updatedConfig.headers = {
            ...updatedConfig.headers,
            ...auth.headers
          };
        }
        if (auth.query) {
          updatedConfig.query = {
            ...updatedConfig.query,
            ...auth.query
          };
        }
        return updatedConfig;
      }), exports_Effect.flatMap((updatedConfig) => {
        if (auth.interceptor) {
          return exports_Effect.tryPromise({
            try: () => Promise.resolve(auth.interceptor(updatedConfig)),
            catch: (error2) => new Error(`Auth interceptor failed: ${error2}`)
          });
        }
        return exports_Effect.succeed(updatedConfig);
      }));
    case "onebun":
      return applyOneBunAuth(auth, config3);
    default:
      return exports_Effect.succeed(config3);
  }
};
var applyOneBunAuth = (auth, config3) => {
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const algorithm = auth.algorithm || "hmac-sha256";
  const payload = [
    config3.method,
    config3.url,
    timestamp,
    nonce,
    auth.serviceId
  ].join(`
`);
  return pipe(generateSignature(payload, auth.secretKey, algorithm), exports_Effect.map((signature) => ({
    ...config3,
    headers: {
      ...config3.headers,
      "X-OneBun-Service-Id": auth.serviceId,
      "X-OneBun-Timestamp": timestamp,
      "X-OneBun-Nonce": nonce,
      "X-OneBun-Algorithm": algorithm,
      "X-OneBun-Signature": signature
    }
  })));
};
var generateSignature = (payload, secretKey, algorithm) => {
  return exports_Effect.tryPromise({
    try: async () => {
      const encoder2 = new TextEncoder;
      const keyData = encoder2.encode(secretKey);
      const payloadData = encoder2.encode(payload);
      const algorithmName = algorithm === "hmac-sha256" ? "SHA-256" : "SHA-512";
      const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: algorithmName }, false, ["sign"]);
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, payloadData);
      return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
    },
    catch: (error2) => new Error(`Failed to generate signature: ${error2}`)
  });
};
var generateNonce = () => {
  const array7 = new Uint8Array(16);
  crypto.getRandomValues(array7);
  return Array.from(array7).map((b) => b.toString(16).padStart(2, "0")).join("");
};
// packages/requests/src/client.ts
init_esm();
var createRequestError = (code, message, options = {}) => ({
  code,
  message,
  details: options.details,
  cause: options.cause,
  statusCode: options.statusCode,
  traceId: options.traceId,
  timestamp: Date.now()
});
var buildUrl = (baseUrl, url2, query) => {
  let fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/${url2.replace(/^\//, "")}` : url2;
  if (query && Object.keys(query).length > 0) {
    const searchParams = new URLSearchParams;
    Object.entries(query).forEach(([key, value6]) => {
      if (value6 !== undefined && value6 !== null) {
        searchParams.append(key, String(value6));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      fullUrl += `${fullUrl.includes("?") ? "&" : "?"}${queryString}`;
    }
  }
  return fullUrl;
};
var calculateRetryDelay = (attempt2, config3) => {
  const { delay: delay3, backoff, factor = 2 } = config3;
  switch (backoff) {
    case "linear":
      return delay3 * attempt2;
    case "exponential":
      return delay3 * Math.pow(factor, attempt2 - 1);
    case "fixed":
    default:
      return delay3;
  }
};
var shouldRetry = (error2, config3) => {
  if (!config3.retryOn || config3.retryOn.length === 0) {
    return false;
  }
  return error2.statusCode !== undefined && config3.retryOn.includes(error2.statusCode);
};
var recordRequestMetrics = (data) => {
  return exports_Effect.sync(() => {
    try {
      if (typeof globalThis !== "undefined" && globalThis.__onebunMetricsService) {
        const metricsService = globalThis.__onebunMetricsService;
        if (metricsService && metricsService.recordHttpRequest) {
          metricsService.recordHttpRequest({
            method: data.method,
            route: data.url,
            statusCode: data.statusCode,
            duration: data.duration / 1000,
            controller: "requests-client",
            action: "http-request"
          });
        }
      }
    } catch (error2) {
      console.debug("Failed to record request metrics:", error2);
    }
  });
};
var getTraceId = (config3, mergedOptions) => {
  if (config3.tracing !== false && mergedOptions.tracing) {
    try {
      if (typeof globalThis !== "undefined" && globalThis.__onebunCurrentTraceContext) {
        return globalThis.__onebunCurrentTraceContext.traceId;
      }
    } catch (error2) {}
  }
  return;
};
var applyAuthIfNeeded = (config3, mergedOptions, traceId) => {
  if (config3.auth || mergedOptions.auth) {
    const authConfig = config3.auth || mergedOptions.auth;
    return pipe(applyAuth(authConfig, config3), exports_Effect.catchAll((error2) => exports_Effect.fail(createRequestError("AUTH_ERROR", `Authentication failed: ${error2}`, { details: error2, traceId }))));
  }
  return exports_Effect.succeed(config3);
};
var buildHeaders = (config3, mergedOptions, traceId) => {
  const headers = {
    "User-Agent": mergedOptions.userAgent || "OneBun-Requests/1.0",
    Accept: "application/json",
    "Content-Type": "application/json",
    ...mergedOptions.headers,
    ...config3.headers
  };
  if (traceId && config3.tracing !== false && mergedOptions.tracing) {
    headers["X-Trace-Id"] = traceId;
  }
  return headers;
};
var parseResponseData = (response, traceId) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return pipe(exports_Effect.tryPromise({
      try: () => response.text(),
      catch: (error2) => createRequestError("RESPONSE_PARSE_ERROR", `Failed to read response text: ${error2}`, { statusCode: response.status, traceId })
    }), exports_Effect.flatMap((text) => {
      if (!text) {
        return exports_Effect.succeed(undefined);
      }
      try {
        return exports_Effect.succeed(JSON.parse(text));
      } catch {
        return exports_Effect.succeed(text);
      }
    }));
  } else {
    return exports_Effect.tryPromise({
      try: () => response.text(),
      catch: (error2) => createRequestError("RESPONSE_READ_ERROR", `Failed to read response: ${error2}`, { statusCode: response.status, traceId })
    });
  }
};
var executeSingleRequest = (config3, mergedOptions, headers, fullUrl, traceId) => {
  const requestStartTime = Date.now();
  const requestInit = {
    method: config3.method,
    headers,
    signal: AbortSignal.timeout(config3.timeout || mergedOptions.timeout || 30000)
  };
  if (config3.data && ["POST", "PUT", "PATCH"].includes(config3.method)) {
    if (typeof config3.data === "string") {
      requestInit.body = config3.data;
    } else {
      requestInit.body = JSON.stringify(config3.data);
    }
  }
  return pipe(exports_Effect.tryPromise({
    try: () => fetch(fullUrl, requestInit),
    catch: (error2) => createRequestError("FETCH_ERROR", `Request failed: ${error2}`, { details: error2, traceId })
  }), exports_Effect.flatMap((response) => {
    const responseHeaders = {};
    response.headers.forEach((value6, key) => {
      responseHeaders[key.toLowerCase()] = value6;
    });
    return pipe(parseResponseData(response, traceId), exports_Effect.map((responseData) => {
      const duration3 = Date.now() - requestStartTime;
      const success = response.status >= 200 && response.status < 300;
      const result = {
        success,
        data: success ? responseData : undefined,
        error: !success ? createRequestError("HTTP_ERROR", `HTTP ${response.status}: ${response.statusText}`, { statusCode: response.status, details: responseData, traceId }) : undefined,
        statusCode: response.status,
        headers: responseHeaders,
        duration: duration3,
        traceId,
        url: fullUrl,
        method: config3.method,
        retryCount: 0
      };
      return result;
    }));
  }));
};
var executeWithRetry = (config3, mergedOptions, headers, fullUrl, traceId, attemptNumber = 1) => {
  return pipe(executeSingleRequest(config3, mergedOptions, headers, fullUrl, traceId), exports_Effect.map((result) => ({ ...result, retryCount: attemptNumber - 1 })), exports_Effect.flatMap((result) => {
    const recordMetrics2 = config3.metrics !== false && mergedOptions.metrics ? recordRequestMetrics({
      method: config3.method,
      url: fullUrl,
      statusCode: result.statusCode,
      duration: result.duration,
      success: result.success,
      retryCount: result.retryCount || 0,
      baseUrl: mergedOptions.baseUrl
    }) : exports_Effect.succeed(undefined);
    return pipe(recordMetrics2, exports_Effect.flatMap(() => {
      if (!result.success && result.error) {
        const retryConfig = {
          max: 3,
          delay: 1000,
          backoff: "exponential",
          factor: 2,
          retryOn: [500, 502, 503, 504],
          ...mergedOptions.retries,
          ...config3.retries
        };
        if (attemptNumber <= retryConfig.max && shouldRetry(result.error, retryConfig)) {
          const callRetryCallback = retryConfig.onRetry ? exports_Effect.tryPromise({
            try: () => Promise.resolve(retryConfig.onRetry(result.error, attemptNumber)),
            catch: () => createRequestError("RETRY_CALLBACK_ERROR", "Retry callback failed")
          }) : exports_Effect.succeed(undefined);
          const delay3 = calculateRetryDelay(attemptNumber, retryConfig);
          return pipe(callRetryCallback, exports_Effect.flatMap(() => exports_Effect.sleep(`${delay3} millis`)), exports_Effect.flatMap(() => executeWithRetry(config3, mergedOptions, headers, fullUrl, traceId, attemptNumber + 1)));
        }
      }
      return exports_Effect.succeed(result);
    }));
  }), exports_Effect.catchAll((error2) => {
    const duration3 = Date.now() - Date.now();
    const recordErrorMetrics = config3.metrics !== false && mergedOptions.metrics ? recordRequestMetrics({
      method: config3.method,
      url: fullUrl,
      statusCode: 0,
      duration: duration3,
      success: false,
      retryCount: attemptNumber - 1,
      baseUrl: mergedOptions.baseUrl
    }) : exports_Effect.succeed(undefined);
    return pipe(recordErrorMetrics, exports_Effect.flatMap(() => {
      const retryConfig = {
        max: 3,
        delay: 1000,
        backoff: "exponential",
        factor: 2,
        retryOn: [500, 502, 503, 504],
        ...mergedOptions.retries,
        ...config3.retries
      };
      if (attemptNumber <= retryConfig.max) {
        const callRetryCallback = retryConfig.onRetry ? exports_Effect.tryPromise({
          try: () => Promise.resolve(retryConfig.onRetry(error2, attemptNumber)),
          catch: () => createRequestError("RETRY_CALLBACK_ERROR", "Retry callback failed")
        }) : exports_Effect.succeed(undefined);
        const delay3 = calculateRetryDelay(attemptNumber, retryConfig);
        return pipe(callRetryCallback, exports_Effect.flatMap(() => exports_Effect.sleep(`${delay3} millis`)), exports_Effect.flatMap(() => executeWithRetry(config3, mergedOptions, headers, fullUrl, traceId, attemptNumber + 1)));
      }
      return exports_Effect.fail(error2);
    }));
  }));
};
var executeRequest = (config3, requestOptions = {}) => {
  const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...requestOptions };
  const fullUrl = buildUrl(mergedOptions.baseUrl, config3.url, config3.query);
  const traceId = getTraceId(config3, mergedOptions);
  return pipe(applyAuthIfNeeded(config3, mergedOptions, traceId), exports_Effect.map((finalConfig) => {
    const headers = buildHeaders(finalConfig, mergedOptions, traceId);
    return { finalConfig, headers };
  }), exports_Effect.flatMap(({ finalConfig, headers }) => executeWithRetry(finalConfig, mergedOptions, headers, fullUrl, traceId)));
};

class HttpClient {
  clientOptions;
  constructor(clientOptions = {}) {
    this.clientOptions = clientOptions;
  }
  requestEffect(config3) {
    const mergedOptions = { ...DEFAULT_REQUESTS_OPTIONS, ...this.clientOptions };
    const fullConfig = {
      method: "GET" /* GET */,
      url: "",
      ...config3
    };
    return executeRequest(fullConfig, mergedOptions);
  }
  async request(config3) {
    return exports_Effect.runPromise(this.requestEffect(config3));
  }
  getEffect(url2, queryOrConfig, config3) {
    let finalConfig;
    if (queryOrConfig && config3) {
      finalConfig = { method: "GET" /* GET */, url: url2, query: queryOrConfig, ...config3 };
    } else if (queryOrConfig && typeof queryOrConfig === "object" && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = "method" in queryOrConfig || "headers" in queryOrConfig || "timeout" in queryOrConfig || "auth" in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: "GET" /* GET */, url: url2, ...queryOrConfig };
      } else {
        finalConfig = { method: "GET" /* GET */, url: url2, query: queryOrConfig };
      }
    } else {
      finalConfig = { method: "GET" /* GET */, url: url2 };
    }
    return this.requestEffect(finalConfig);
  }
  async get(url2, queryOrConfig, config3) {
    return exports_Effect.runPromise(this.getEffect(url2, queryOrConfig, config3));
  }
  postEffect(url2, data, config3) {
    return this.requestEffect({ method: "POST" /* POST */, url: url2, data, ...config3 });
  }
  async post(url2, data, config3) {
    return exports_Effect.runPromise(this.postEffect(url2, data, config3));
  }
  putEffect(url2, data, config3) {
    return this.requestEffect({ method: "PUT" /* PUT */, url: url2, data, ...config3 });
  }
  async put(url2, data, config3) {
    return exports_Effect.runPromise(this.putEffect(url2, data, config3));
  }
  patchEffect(url2, data, config3) {
    return this.requestEffect({ method: "PATCH" /* PATCH */, url: url2, data, ...config3 });
  }
  async patch(url2, data, config3) {
    return exports_Effect.runPromise(this.patchEffect(url2, data, config3));
  }
  deleteEffect(url2, queryOrConfig, config3) {
    let finalConfig;
    if (queryOrConfig && config3) {
      finalConfig = { method: "DELETE" /* DELETE */, url: url2, query: queryOrConfig, ...config3 };
    } else if (queryOrConfig && typeof queryOrConfig === "object" && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = "method" in queryOrConfig || "headers" in queryOrConfig || "timeout" in queryOrConfig || "auth" in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: "DELETE" /* DELETE */, url: url2, ...queryOrConfig };
      } else {
        finalConfig = { method: "DELETE" /* DELETE */, url: url2, query: queryOrConfig };
      }
    } else {
      finalConfig = { method: "DELETE" /* DELETE */, url: url2 };
    }
    return this.requestEffect(finalConfig);
  }
  async delete(url2, queryOrConfig, config3) {
    return exports_Effect.runPromise(this.deleteEffect(url2, queryOrConfig, config3));
  }
  headEffect(url2, queryOrConfig, config3) {
    let finalConfig;
    if (queryOrConfig && config3) {
      finalConfig = { method: "HEAD" /* HEAD */, url: url2, query: queryOrConfig, ...config3 };
    } else if (queryOrConfig && typeof queryOrConfig === "object" && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = "method" in queryOrConfig || "headers" in queryOrConfig || "timeout" in queryOrConfig || "auth" in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: "HEAD" /* HEAD */, url: url2, ...queryOrConfig };
      } else {
        finalConfig = { method: "HEAD" /* HEAD */, url: url2, query: queryOrConfig };
      }
    } else {
      finalConfig = { method: "HEAD" /* HEAD */, url: url2 };
    }
    return this.requestEffect(finalConfig);
  }
  async head(url2, queryOrConfig, config3) {
    return exports_Effect.runPromise(this.headEffect(url2, queryOrConfig, config3));
  }
  optionsEffect(url2, queryOrConfig, config3) {
    let finalConfig;
    if (queryOrConfig && config3) {
      finalConfig = { method: "OPTIONS" /* OPTIONS */, url: url2, query: queryOrConfig, ...config3 };
    } else if (queryOrConfig && typeof queryOrConfig === "object" && !Array.isArray(queryOrConfig)) {
      const hasConfigFields = "method" in queryOrConfig || "headers" in queryOrConfig || "timeout" in queryOrConfig || "auth" in queryOrConfig;
      if (hasConfigFields) {
        finalConfig = { method: "OPTIONS" /* OPTIONS */, url: url2, ...queryOrConfig };
      } else {
        finalConfig = { method: "OPTIONS" /* OPTIONS */, url: url2, query: queryOrConfig };
      }
    } else {
      finalConfig = { method: "OPTIONS" /* OPTIONS */, url: url2 };
    }
    return this.requestEffect(finalConfig);
  }
  async options(url2, queryOrConfig, config3) {
    return exports_Effect.runPromise(this.optionsEffect(url2, queryOrConfig, config3));
  }
}
var createHttpClient = (clientOptions = {}) => {
  return new HttpClient(clientOptions);
};
// packages/requests/src/service.ts
init_esm();
var RequestsService = exports_Context.GenericTag("@onebun/requests/RequestsService");
// example/src/external-api.service.ts
init_esm();
class ExternalApiService extends BaseService {
  client = createHttpClient({
    baseUrl: "https://jsonplaceholder.typicode.com",
    timeout: 5000,
    retries: {
      max: 2,
      delay: 1000,
      backoff: "exponential",
      retryOn: [408, 429, 500, 502, 503, 504]
    },
    tracing: true,
    metrics: true,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  });
  async getAllUsers(query = {}) {
    console.log("\uD83D\uDE80 Fetching users with @onebun/requests (Promise API)");
    try {
      const response = await this.client.get("/users", query);
      if (response.success && response.data) {
        console.log(`✅ Fetched ${response.data.length} users in ${response.duration}ms`);
        return response.data;
      }
      return [];
    } catch (error2) {
      console.error(`❌ Failed to fetch users: ${error2.message}`, {
        code: error2.code,
        statusCode: error2.statusCode,
        traceId: error2.traceId
      });
      return [];
    }
  }
  async getUserById(id2) {
    this.logger.info(`\uD83D\uDE80 Getting user ${id2} with @onebun/requests (Promise API)`);
    try {
      const response = await this.client.get(`/users/${id2}`);
      if (response.success && response.data) {
        console.log(`✅ Fetched user: ${response.data.name} in ${response.duration}ms`);
        return response.data;
      }
      throw {
        code: "USER_NOT_FOUND",
        message: `User with ID ${id2} not found`,
        statusCode: response.statusCode,
        traceId: response.traceId,
        timestamp: Date.now()
      };
    } catch (error2) {
      throw error2;
    }
  }
  async getPostsByUserId(userId) {
    console.log(`\uD83D\uDE80 Getting posts for user ${userId} with typed query params (Promise API)`);
    try {
      const query = { userId: userId.toString() };
      const response = await this.client.get("/posts", query);
      if (response.success && response.data) {
        console.log(`✅ Fetched ${response.data.length} posts in ${response.duration}ms`);
        return response.data;
      }
      return [];
    } catch (error2) {
      console.error(`❌ Failed to fetch posts for user ${userId}:`, {
        message: error2.message,
        code: error2.code,
        statusCode: error2.statusCode,
        traceId: error2.traceId
      });
      return [];
    }
  }
  async createPost(postData) {
    console.log("\uD83D\uDE80 Creating post with typed data interface (Promise API)");
    try {
      const response = await this.client.post("/posts", postData);
      if (response.success && response.data) {
        console.log(`✅ Created post ${response.data.id}: ${response.data.title} in ${response.duration}ms`);
        return response.data;
      }
      throw {
        code: "POST_CREATION_FAILED",
        message: "Failed to create post",
        statusCode: response.statusCode,
        details: response.error,
        traceId: response.traceId,
        timestamp: Date.now()
      };
    } catch (error2) {
      throw error2;
    }
  }
  async updateUser(id2, userData) {
    console.log(`\uD83D\uDE80 Updating user ${id2} with typed data interface (Promise API)`);
    try {
      const response = await this.client.put(`/users/${id2}`, userData);
      if (response.success && response.data) {
        console.log(`✅ Updated user ${response.data.id}: ${response.data.name} in ${response.duration}ms`);
        return response.data;
      }
      throw {
        code: "USER_UPDATE_FAILED",
        message: "Failed to update user",
        statusCode: response.statusCode,
        traceId: response.traceId,
        timestamp: Date.now()
      };
    } catch (error2) {
      throw error2;
    }
  }
  async demonstrateErrorHandling() {
    console.log("\uD83D\uDE80 Demonstrating @onebun/requests error handling (Promise API)");
    try {
      await this.client.get("/nonexistent-endpoint");
    } catch (error2) {
      console.log("\uD83D\uDCA5 @onebun/requests error handling demonstration:");
      console.log(`- Error code: ${error2.code}`);
      console.log(`- Message: ${error2.message}`);
      console.log(`- Status: ${error2.statusCode || "N/A"}`);
      console.log(`- Trace ID: ${error2.traceId || "N/A"}`);
      console.log(`- Timestamp: ${new Date(error2.timestamp).toISOString()}`);
      if (error2.cause) {
        console.log(`- Caused by: ${error2.cause.message}`);
      }
      console.log("✅ Error handling demonstration completed");
    }
  }
  demonstrateErrorHandlingEffect() {
    console.log("\uD83D\uDE80 Demonstrating @onebun/requests error handling (Effect API)");
    return pipe(this.client.getEffect("/nonexistent-endpoint"), exports_Effect.catchAll((error2) => {
      console.log("\uD83D\uDCA5 @onebun/requests error handling demonstration:");
      console.log(`- Error code: ${error2.code}`);
      console.log(`- Message: ${error2.message}`);
      console.log(`- Status: ${error2.statusCode || "N/A"}`);
      console.log(`- Trace ID: ${error2.traceId || "N/A"}`);
      console.log(`- Timestamp: ${new Date(error2.timestamp).toISOString()}`);
      if (error2.cause) {
        console.log(`- Caused by: ${error2.cause.message}`);
      }
      console.log("✅ Error handling demonstration completed");
      return exports_Effect.succeed(undefined);
    }), exports_Effect.map(() => {
      return;
    }));
  }
  async demonstrateAuthentication() {
    console.log("\uD83D\uDD10 @onebun/requests Authentication Examples:");
    const bearerClient = createHttpClient({
      baseUrl: "https://api.example.com",
      auth: {
        type: "bearer",
        token: "your-bearer-token"
      }
    });
    const apiKeyClient = createHttpClient({
      baseUrl: "https://api.example.com",
      auth: {
        type: "apikey",
        key: "X-API-Key",
        value: "your-api-key"
      }
    });
    const basicAuthClient = createHttpClient({
      baseUrl: "https://api.example.com",
      auth: {
        type: "basic",
        username: "user",
        password: "pass"
      }
    });
    console.log("✅ Authentication clients created - ready for use");
    console.log("- Bearer token auth configured");
    console.log("- API key auth configured");
    console.log("- Basic auth configured");
  }
  async demonstrateRetries() {
    console.log("\uD83D\uDD04 Demonstrating @onebun/requests retry functionality (Promise API)");
    const retryClient = createHttpClient({
      baseUrl: "https://httpstat.us",
      timeout: 2000,
      retries: {
        max: 3,
        delay: 1000,
        backoff: "exponential",
        factor: 2,
        retryOn: [500, 502, 503, 504]
      }
    });
    try {
      console.log("\uD83D\uDCE1 Attempting request to endpoint that returns 500 (will retry)...");
      await retryClient.get("/500");
    } catch (error2) {
      console.log(`\uD83D\uDCA5 Request failed after retries: ${error2.message}`);
      console.log("✅ Retry functionality demonstrated");
    }
  }
  demonstrateRetriesEffect() {
    console.log("\uD83D\uDD04 Demonstrating @onebun/requests retry functionality (Effect API)");
    const retryClient = createHttpClient({
      baseUrl: "https://httpstat.us",
      timeout: 2000,
      retries: {
        max: 3,
        delay: 1000,
        backoff: "exponential",
        factor: 2,
        retryOn: [500, 502, 503, 504]
      }
    });
    return pipe(exports_Effect.sync(() => console.log("\uD83D\uDCE1 Attempting request to endpoint that returns 500 (will retry)...")), exports_Effect.flatMap(() => retryClient.getEffect("/500")), exports_Effect.catchAll((error2) => {
      console.log(`\uD83D\uDCA5 Request failed after retries: ${error2.message}`);
      console.log("✅ Retry functionality demonstrated");
      return exports_Effect.succeed(undefined);
    }), exports_Effect.map(() => {
      return;
    }));
  }
}
ExternalApiService = __legacyDecorateClassTS([
  Service2()
], ExternalApiService);
export {
  ExternalApiService
};
