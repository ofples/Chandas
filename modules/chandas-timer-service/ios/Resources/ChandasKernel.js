"use strict";
var ChandasKernel = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/ios-timer-kernel.ts
  var ios_timer_kernel_exports = {};
  __export(ios_timer_kernel_exports, {
    IOS_MAX_PLANNING_MS: () => IOS_MAX_PLANNING_MS,
    IOS_NOTIFICATION_BUDGET: () => IOS_NOTIFICATION_BUDGET,
    invokeIOSKernel: () => invokeIOSKernel,
    iosEventBatches: () => iosEventBatches,
    iosRunAction: () => iosRunAction,
    iosRunState: () => iosRunState,
    validateIOSRun: () => validateIOSRun
  });

  // src/lib/bell-points.ts
  function bellPoints(track) {
    return [
      ...track.points ?? [],
      ...track.afterStartSeconds === void 0 ? [] : [{ id: "legacy-after", kind: "start", value: track.afterStartSeconds }],
      ...track.beforeEndSeconds === void 0 ? [] : [{ id: "legacy-before", kind: "end", value: track.beforeEndSeconds }]
    ];
  }
  function bellPointSeconds(point, durationSeconds) {
    return point.kind === "percent" ? Math.floor(durationSeconds * point.value / 100 + 0.5) : point.kind === "end" ? durationSeconds - point.value : point.value;
  }
  function bellPointOffsets(track, durationSeconds) {
    return [...new Set(bellPoints(track).map((point) => bellPointSeconds(point, durationSeconds)).filter((seconds) => seconds > 0 && seconds < durationSeconds))].sort((a, b) => a - b);
  }
  function validBellPoints(value) {
    if (!Array.isArray(value) || value.length > 32) return false;
    const ids = /* @__PURE__ */ new Set();
    return value.every((point) => {
      if (!point || typeof point !== "object" || typeof point.id !== "string" || !point.id.length || point.id.length > 128 || ids.has(point.id)) return false;
      ids.add(point.id);
      return point.kind === "percent" ? Number.isFinite(point.value) && point.value >= 0.1 && point.value <= 99.9 && Math.abs(point.value * 10 - Math.round(point.value * 10)) < 1e-6 : (point.kind === "start" || point.kind === "end") && Number.isSafeInteger(point.value) && point.value >= 1 && point.value <= 14400;
    });
  }

  // src/lib/subBellColors.ts
  var SUB_BELL_COLORS = [
    { id: "violet", label: "Violet", value: "#7C6FF7" },
    { id: "blue", label: "Blue", value: "#5B8DEF" },
    { id: "cyan", label: "Cyan", value: "#4AAFD1" },
    { id: "teal", label: "Teal", value: "#43B7A0" },
    { id: "green", label: "Green", value: "#70B66A" },
    { id: "lime", label: "Lime", value: "#A5B957" },
    { id: "amber", label: "Amber", value: "#D5AA55" },
    { id: "orange", label: "Orange", value: "#DE8B55" },
    { id: "coral", label: "Coral", value: "#DB6F73" },
    { id: "rose", label: "Rose", value: "#D76BA5" }
  ];
  var IDS = new Set(SUB_BELL_COLORS.map((option) => option.id));
  function isTimerColor(value) {
    return typeof value === "string" && IDS.has(value);
  }

  // src/lib/timerV2.ts
  var MAX_PATTERN_TRACKS = 5;
  var MAX_SEQUENCE_STEPS = 20;
  var MIN_DURATION_MINUTES = 1;
  var MAX_DURATION_MINUTES = 240;
  var MIN_CUE_DURATION_SECONDS = 1;
  var MAX_CUE_DURATION_SECONDS = MAX_DURATION_MINUTES * 60;
  var MAX_RUN_CYCLES = 999;
  var MAX_RUN_DURATION_SECONDS = 359 * 3600 + 59 * 60 + 59;
  var BUILT_IN_SOUND_IDS = /* @__PURE__ */ new Set([
    "alarm-tone",
    "temple-gong",
    "clear-bell",
    "bloom",
    "boxing-bell",
    "bubble",
    "champagne",
    "cymbal",
    "handpan",
    "heartbeat",
    "ice",
    "instamatic",
    "mouse-click",
    "page",
    "sine-bass",
    "sine-high",
    "sine-low",
    "water-drop",
    "wind"
  ]);
  var LEGACY_BUILT_IN_SOUND_ALIASES = {
    "soft-bowl": "handpan",
    "wood-block": "instamatic",
    "bright-chime": "bloom"
  };
  var MAX_URI_CHARACTERS = 8192;
  var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  var whole = (value, fallback) => {
    const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
    return parsed;
  };
  function clampDuration(value, fallback) {
    return clamp(whole(value, fallback), MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);
  }
  function clampCueDurationSeconds(value, fallback) {
    return clamp(whole(value, fallback), MIN_CUE_DURATION_SECONDS, MAX_CUE_DURATION_SECONDS);
  }
  function patternDurationSeconds(program) {
    return clampCueDurationSeconds(program.mainDurationSeconds, clampDuration(program.mainMinutes, 30) * 60);
  }
  function sequenceStepDurationSeconds(step) {
    return clampCueDurationSeconds(step.durationSeconds, clampDuration(step.durationMinutes, 5) * 60);
  }
  function trackCadenceSeconds(track) {
    return clampCueDurationSeconds(track.cadenceSeconds, clampDuration(track.cadenceMinutes, 1) * 60);
  }
  function trackSelectedOffsetsSeconds(track) {
    const source = Array.isArray(track.selectedOffsetsSeconds) ? track.selectedOffsetsSeconds : track.selectedOffsetsMinutes.map((offset) => offset * 60);
    return source.map((offset) => whole(offset, -1)).filter((offset) => offset > 0);
  }
  function randomTrackOffsetsSeconds(trackId, range, mainDurationSeconds, cycleIndex = 0, anchor = 0) {
    const min = Math.max(5, Math.floor(range.minSeconds));
    const max = Math.max(min, Math.floor(range.maxSeconds));
    let seed = Math.floor(anchor) ^ cycleIndex | 0;
    for (let index = 0; index < trackId.length; index += 1) seed = Math.imul(seed, 31) + trackId.charCodeAt(index) | 0;
    const offsets = [];
    let offset = 0;
    while (offset < mainDurationSeconds && offsets.length < 4096) {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0;
      offset += min + (seed >>> 0) % (max - min + 1);
      if (offset < mainDurationSeconds) offsets.push(offset);
    }
    return offsets;
  }
  function trackEventOffsetsSeconds(track, mainDurationSeconds, cycleIndex = 0, anchor = 0) {
    const main = clampCueDurationSeconds(mainDurationSeconds, 60);
    const offsets = track.repeatEnabled === false ? [] : trackSelectedOffsetsSeconds(track);
    if (track.randomRepeat) offsets.push(...randomTrackOffsetsSeconds(track.id, track.randomRepeat, main, cycleIndex, anchor));
    offsets.push(...bellPointOffsets(track, main));
    return [...new Set(offsets.filter((offset) => offset > 0 && offset < main))].sort((left, right) => left - right);
  }
  function soundRefKey(sound) {
    return sound.kind === "builtin" ? `builtin:${sound.id}` : `${sound.kind}:${sound.uri}`;
  }
  function cueSounds(cue) {
    const source = Array.isArray(cue.sounds) && cue.sounds.length > 0 ? cue.sounds : [cue.sound];
    const unique = [];
    source.forEach((sound) => {
      if (!unique.some((value) => soundRefKey(value) === soundRefKey(sound))) unique.push(sound);
    });
    return unique.length ? unique : [cue.sound];
  }
  function isSupportedSoundRef(value, allowLegacyAliases = false) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value;
    if (candidate.kind === "builtin" && typeof candidate.id === "string") {
      const id = allowLegacyAliases ? LEGACY_BUILT_IN_SOUND_ALIASES[candidate.id] ?? candidate.id : candidate.id;
      return BUILT_IN_SOUND_IDS.has(id);
    }
    if (candidate.kind === "android" && typeof candidate.uri === "string" && isPersistentSoundUri("android", candidate.uri) && candidate.uri.length <= MAX_URI_CHARACTERS && typeof candidate.title === "string" && [...candidate.title].length <= 60) {
      return candidate.ringtoneType === "alarm" || candidate.ringtoneType === "notification" || candidate.ringtoneType === "unknown";
    }
    return candidate.kind === "document" && typeof candidate.uri === "string" && isPersistentSoundUri("document", candidate.uri) && candidate.uri.length <= MAX_URI_CHARACTERS && typeof candidate.title === "string" && [...candidate.title].length <= 60 && (candidate.mimeType === void 0 || typeof candidate.mimeType === "string");
  }
  function isPersistentSoundUri(kind, uri) {
    if (uri.length === 0) return false;
    if (/^content:\/\//i.test(uri)) return true;
    return kind === "android" && /^android\.resource:\/\//i.test(uri);
  }

  // src/lib/unified-timer.ts
  var UNIFIED_TIMER_SCHEMA_VERSION = 4;
  var MAX_UNIFIED_STEPS = MAX_SEQUENCE_STEPS;
  var MAX_UNIFIED_TRACKS_PER_STEP = MAX_PATTERN_TRACKS;
  var isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  var isIntIn = (value, min, max) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
  var validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;
  function validSound(value) {
    return isSupportedSoundRef(value);
  }
  function validCue(value) {
    if (!isRecord(value) || !validSound(value.sound) || typeof value.volume !== "number" || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) return false;
    if (value.soundMuted !== void 0 && typeof value.soundMuted !== "boolean") return false;
    if (value.sounds !== void 0 && (!Array.isArray(value.sounds) || value.sounds.length < 1 || !value.sounds.every(validSound))) return false;
    if (value.soundMode !== void 0 && value.soundMode !== "single" && value.soundMode !== "sequence" && value.soundMode !== "random") return false;
    if (value.hapticOverride !== void 0 && value.hapticOverride !== "off" && (!isRecord(value.hapticOverride) || !["single", "double", "triple"].includes(String(value.hapticOverride.pattern)) || !["gentle", "balanced", "strong"].includes(String(value.hapticOverride.strength)))) return false;
    return true;
  }
  function validRunPolicy(value) {
    return isRecord(value) && (value.kind === "continuous" || value.kind === "cycles" || value.kind === "duration" || value.kind === "until") && (value.kind !== "until" && value.untilMinutes === void 0 || isIntIn(value.untilMinutes, 0, 1439)) && isIntIn(value.cycleCount, 1, MAX_RUN_CYCLES) && isIntIn(value.durationSeconds, 1, MAX_RUN_DURATION_SECONDS);
  }
  function validateProgram(value) {
    if (!isRecord(value)) return "Program must be an object";
    if (value.schemaVersion !== UNIFIED_TIMER_SCHEMA_VERSION) return `Unsupported program schema version: ${String(value.schemaVersion)}`;
    if (value.mode !== "unified") return "Program mode must be unified";
    if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > MAX_UNIFIED_STEPS) return `Program must contain 1 to ${MAX_UNIFIED_STEPS} steps`;
    if (!isRecord(value.alignment) || value.alignment.kind !== "elapsed" && value.alignment.kind !== "local-clock") return "Invalid alignment";
    if (value.alignment.kind === "local-clock" && !isIntIn(value.alignment.offsetMinutes, 0, 59)) return "Invalid clock alignment offset";
    if (value.completionCue !== null && !validCue(value.completionCue)) return "Invalid completion cue";
    if (!validRunPolicy(value.runPolicy)) return "Invalid run policy";
    if (value.noMainInterval !== void 0 && typeof value.noMainInterval !== "boolean") return "Invalid main interval mode";
    if (value.noMainInterval && (value.steps.length !== 1 || value.alignment.kind !== "elapsed" || value.runPolicy.kind === "cycles")) return "Invalid timer without a main interval";
    if (value.alarmBehavior !== void 0 && value.alarmBehavior !== "off" && value.alarmBehavior !== "once" && value.alarmBehavior !== "locked") return "Invalid alarm behavior";
    if (value.alarmOverrides !== void 0) {
      const overrides = value.alarmOverrides;
      if (!isRecord(overrides) || overrides.sound != null && !isSupportedSoundRef(overrides.sound, false) || overrides.durationSeconds != null && !isIntIn(overrides.durationSeconds, 5, 3600)) return "Invalid alarm overrides";
    }
    const stepIds = /* @__PURE__ */ new Set();
    for (const [index, step] of value.steps.entries()) {
      if (!isRecord(step) || !validId(step.id) || stepIds.has(step.id)) return `Invalid or duplicate step id at index ${index}`;
      stepIds.add(step.id);
      if (typeof step.label !== "string" || [...step.label].length > 60) return `Invalid step label at index ${index}`;
      if (step.labelIsCustom !== void 0 && typeof step.labelIsCustom !== "boolean") return `Invalid label intent at index ${index}`;
      if (step.color !== void 0 && !isTimerColor(step.color)) return `Invalid step color at index ${index}`;
      if (!isIntIn(step.durationSeconds, 1, MAX_CUE_DURATION_SECONDS)) return `Invalid step duration at index ${index}`;
      if (!validCue(step.endCue)) return `Invalid end cue at index ${index}`;
      if (typeof step.endAlarmEnabled !== "boolean" || typeof step.subBellsEnabled !== "boolean") return `Invalid step settings at index ${index}`;
      if (!Array.isArray(step.subBellTracks) || step.subBellTracks.length > MAX_UNIFIED_TRACKS_PER_STEP) return `Invalid sub-bell tracks at index ${index}`;
      const trackIds = /* @__PURE__ */ new Set();
      for (const [trackIndex, track] of step.subBellTracks.entries()) {
        if (!isRecord(track) || !validId(track.id) || trackIds.has(track.id)) return `Invalid or duplicate track id at ${index}:${trackIndex}`;
        trackIds.add(track.id);
        if (typeof track.label !== "string" || [...track.label].length > 60 || typeof track.enabled !== "boolean" || typeof track.showOnWatchFace !== "boolean") return `Invalid track settings at ${index}:${trackIndex}`;
        if (track.color !== void 0 && !isTimerColor(track.color)) return `Invalid track color at ${index}:${trackIndex}`;
        if (!isIntIn(track.cadenceSeconds, 1, MAX_CUE_DURATION_SECONDS) || typeof track.repeatEnabled !== "boolean") return `Invalid track cadence at ${index}:${trackIndex}`;
        if (!Array.isArray(track.selectedOffsetsSeconds) || !track.selectedOffsetsSeconds.every((offset) => isIntIn(offset, 1, MAX_CUE_DURATION_SECONDS))) return `Invalid selected offsets at ${index}:${trackIndex}`;
        if (track.randomRepeat !== void 0 && (!isRecord(track.randomRepeat) || !isIntIn(track.randomRepeat.minSeconds, 5, MAX_CUE_DURATION_SECONDS) || !isIntIn(track.randomRepeat.maxSeconds, track.randomRepeat.minSeconds, MAX_CUE_DURATION_SECONDS))) return `Invalid random range at ${index}:${trackIndex}`;
        if (track.afterStartSeconds !== void 0 && !isIntIn(track.afterStartSeconds, 1, MAX_CUE_DURATION_SECONDS)) return `Invalid after-start offset at ${index}:${trackIndex}`;
        if (track.beforeEndSeconds !== void 0 && !isIntIn(track.beforeEndSeconds, 1, MAX_CUE_DURATION_SECONDS)) return `Invalid before-end offset at ${index}:${trackIndex}`;
        if (track.points !== void 0 && !validBellPoints(track.points)) return `Invalid bell points at ${index}:${trackIndex}`;
        if (!validCue(track)) return `Invalid track cue at ${index}:${trackIndex}`;
      }
    }
    return null;
  }
  function parseUnifiedTimerProgram(input) {
    let raw = input;
    if (typeof input === "string") {
      try {
        raw = JSON.parse(input);
      } catch {
        return { ok: false, raw: input, reason: "Program is not valid JSON" };
      }
    }
    const reason = validateProgram(raw);
    if (reason) return { ok: false, raw: input, reason };
    const program = raw;
    return {
      ok: true,
      value: {
        ...program,
        alarmBehavior: program.alarmBehavior ?? "off",
        steps: program.steps.map((step) => ({ ...step, endCue: cloneCue(step.endCue), subBellTracks: step.subBellTracks.map((track) => ({ ...track, ...track.points ? { points: track.points.map((point) => ({ ...point })) } : {}, selectedOffsetsSeconds: [...track.selectedOffsetsSeconds], ...track.randomRepeat ? { randomRepeat: { ...track.randomRepeat } } : {}, ...cloneCue(track) })) })),
        alignment: { ...program.alignment },
        completionCue: program.completionCue ? cloneCue(program.completionCue) : null,
        runPolicy: { ...program.runPolicy }
      }
    };
  }
  function cloneCue(cue) {
    return { sound: { ...cue.sound }, volume: cue.volume, ...cue.soundMuted ? { soundMuted: true } : {}, ...cue.sounds ? { sounds: cue.sounds.map((sound) => ({ ...sound })) } : {}, ...cue.soundMode ? { soundMode: cue.soundMode } : {}, ...cue.hapticOverride ? { hapticOverride: cue.hapticOverride === "off" ? "off" : { ...cue.hapticOverride } } : {} };
  }

  // src/lib/time-inputs.ts
  function nextLocalClockTime(minutes, now) {
    const deadline = new Date(now);
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    deadline.setHours(hour, minute, 0, 0);
    if (deadline.getTime() <= now) {
      deadline.setTime(now);
      deadline.setDate(deadline.getDate() + 1);
      deadline.setHours(hour, minute, 0, 0);
    }
    return deadline.getTime();
  }

  // src/lib/unified-timeline.ts
  var SECOND_MS = 1e3;
  var MAX_MUTE_ITERATIONS = 99;
  function unifiedCueIdentity(stepId, trackId) {
    const part = (value) => `${value.length}:${value}`;
    return trackId === void 0 ? `step:${part(stepId)}` : `track:${part(stepId)}${part(trackId)}`;
  }
  function durations(program) {
    if (!program.steps.length) throw new Error("Unified program requires at least one step");
    return program.steps.map((step) => {
      if (!Number.isSafeInteger(step.durationSeconds) || step.durationSeconds < 1 || step.durationSeconds > 14400) throw new Error("Unified step duration must be 1 to 14,400 exact seconds");
      return step.durationSeconds * SECOND_MS;
    });
  }
  function unifiedProgramDurationMs(program) {
    return durations(program).reduce((sum, value) => sum + value, 0);
  }
  function unifiedRunEndAt(program, anchor, startedAt) {
    const policy = program.runPolicy;
    if (policy.kind === "continuous") return null;
    if (policy.kind === "duration") return startedAt + policy.durationSeconds * SECOND_MS;
    if (policy.kind === "until") return nextLocalClockTime(policy.untilMinutes ?? 0, startedAt);
    const duration = unifiedProgramDurationMs(program);
    const firstBoundary = anchor + (Math.floor((startedAt - anchor) / duration) + 1) * duration;
    return firstBoundary + (policy.cycleCount - 1) * duration;
  }
  function roundAt(now, anchor, duration) {
    return Math.max(0, Math.floor((now - anchor) / duration));
  }
  function cueCandidate(cue, step, stepIndex, track, trackOrder) {
    const isTrack = !!track;
    return {
      cueId: unifiedCueIdentity(step.id, track?.id),
      sourceCueId: isTrack ? track.id : step.id,
      stepId: step.id,
      ...track ? { trackId: track.id } : {},
      kind: isTrack ? "sub-bell" : "step-end",
      ...!isTrack && step.endAlarmEnabled ? { alarmEnabled: true } : {},
      sound: cue.sound,
      volume: cue.soundMuted ? 0 : cue.volume,
      ...cue.sounds ? { sounds: cue.sounds } : {},
      ...cue.soundMode ? { soundMode: cue.soundMode } : {},
      ...cue.hapticOverride ? { hapticOverride: cue.hapticOverride } : {},
      showOnWatchFace: track?.showOnWatchFace !== false,
      ...track ? { cadenceSeconds: track.cadenceSeconds, cadencePriority: track.repeatEnabled ? track.cadenceSeconds : 0, trackOrder } : { cadencePriority: 0 }
    };
  }
  function randomOffsets(track, durationSeconds, roundIndex, seedAnchor) {
    return track.randomRepeat ? randomTrackOffsetsSeconds(track.id, track.randomRepeat, durationSeconds, roundIndex, seedAnchor) : [];
  }
  function offsetsForTrack(track, durationSeconds, roundIndex, randomSeed) {
    const offsets = track.repeatEnabled ? track.selectedOffsetsSeconds : [];
    const values = [...offsets, ...randomOffsets(track, durationSeconds, roundIndex, randomSeed)];
    values.push(...bellPointOffsets(track, durationSeconds));
    return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0 && value < durationSeconds))].sort((a, b) => a - b);
  }
  function winnerFor(candidates) {
    return candidates.slice().sort((a, b) => Number(!!b.explicitMarker) - Number(!!a.explicitMarker) || b.cadencePriority - a.cadencePriority || (a.trackOrder ?? Number.MAX_SAFE_INTEGER) - (b.trackOrder ?? Number.MAX_SAFE_INTEGER))[0];
  }
  function candidateGroups(program, roundIndex, stepIndex, stepStart, randomSeed, visibleOnly) {
    const step = program.steps[stepIndex];
    const durationSeconds = step.durationSeconds;
    const endAt = stepStart + durationSeconds * SECOND_MS;
    const result = /* @__PURE__ */ new Map();
    result.set(endAt, [cueCandidate(step.endCue, step, stepIndex)]);
    if (!step.subBellsEnabled) return result;
    step.subBellTracks.forEach((track, trackOrder) => {
      if (!track.enabled || visibleOnly && !track.showOnWatchFace) return;
      const offsets = offsetsForTrack(track, durationSeconds, roundIndex, randomSeed);
      offsets.forEach((offsetSeconds) => {
        const at = stepStart + offsetSeconds * SECOND_MS;
        const candidates = result.get(at) ?? [];
        const candidate = cueCandidate(track, step, stepIndex, track, trackOrder);
        candidate.occurrencesPerRound = offsets.length;
        if (bellPointOffsets(track, durationSeconds).includes(offsetSeconds)) {
          candidate.explicitMarker = true;
        }
        candidates.push(candidate);
        result.set(at, candidates);
      });
    });
    return result;
  }
  function completionCandidate(program) {
    const last = program.steps[program.steps.length - 1];
    const cue = program.completionCue ?? last.endCue;
    return {
      cueId: "run-complete",
      sourceCueId: "run-complete",
      stepId: last.id,
      kind: "run-complete",
      sound: cue.sound,
      volume: cue.soundMuted || program.noMainInterval && !program.completionCue ? 0 : cue.volume,
      ...cue.sounds ? { sounds: cue.sounds } : {},
      ...cue.soundMode ? { soundMode: cue.soundMode } : {},
      hapticOverride: program.noMainInterval && !program.completionCue ? "off" : cue.hapticOverride,
      showOnWatchFace: true,
      cadencePriority: 0
    };
  }
  function nextUnboundedRandomOffset(id, min, max, elapsed, seed) {
    const spread = Math.floor((max - min) / 2);
    const stride = min + spread;
    let trackSeed = seed | 0;
    for (let i = 0; i < id.length; i++) trackSeed = Math.imul(trackSeed, 31) + id.charCodeAt(i) | 0;
    const position = (index2) => {
      let hash2 = trackSeed ^ Math.imul(index2 + 1, 2654435769);
      hash2 = Math.imul(hash2 ^ hash2 >>> 16, 73244475);
      hash2 = Math.imul(hash2 ^ hash2 >>> 16, 73244475);
      return index2 * stride + min + ((hash2 ^ hash2 >>> 16) >>> 0) % (spread + 1);
    };
    const index = Math.max(0, Math.floor((elapsed - min) / stride));
    const at = position(index);
    return at > elapsed ? at : position(index + 1);
  }
  function unboundedBell(program, anchor, now, randomSeed, visibleOnly) {
    const step = program.steps[0];
    const elapsed = (now - anchor) / SECOND_MS;
    let offset = Infinity;
    let candidates = [];
    step.subBellTracks.forEach((track, index) => {
      if (!track.enabled || visibleOnly && !track.showOnWatchFace) return;
      const fixed = track.repeatEnabled ? Math.max(1, Math.floor(elapsed / track.cadenceSeconds) + 1) * track.cadenceSeconds : Infinity;
      const range = track.randomRepeat;
      const random = range ? nextUnboundedRandomOffset(track.id, range.minSeconds, range.maxSeconds, elapsed, randomSeed) : Infinity;
      const next = Math.min(fixed, random);
      if (!Number.isFinite(next) || next > offset) return;
      if (next < offset) {
        offset = next;
        candidates = [];
      }
      const spacing = fixed === next ? track.cadenceSeconds : Math.floor((range.minSeconds + range.maxSeconds) / 2);
      candidates.push({ ...cueCandidate(track, step, 0, track, index), cadenceSeconds: spacing, cadencePriority: spacing });
    });
    if (!candidates.length) return null;
    return {
      at: anchor + offset * SECOND_MS,
      logicalId: `unified:${anchor}:bells:${offset}`,
      roundIndex: 0,
      cycleIndex: 0,
      stepIndex: 0,
      stepId: step.id,
      offsetSeconds: offset,
      boundary: "step-offset",
      isRoundEnd: false,
      candidates,
      winner: winnerFor(candidates),
      collision: candidates.length > 1,
      completesRun: false,
      showOnWatchFace: candidates.some((candidate) => candidate.showOnWatchFace)
    };
  }
  function naturalEvent(program, anchor, now, randomSeed, visibleOnly) {
    const stepDurations = durations(program);
    const roundDuration = stepDurations.reduce((sum, value) => sum + value, 0);
    let roundIndex = roundAt(now, anchor, roundDuration);
    while (roundIndex < Number.MAX_SAFE_INTEGER / roundDuration) {
      const roundStart = anchor + roundIndex * roundDuration;
      let stepStart = roundStart;
      for (let stepIndex = 0; stepIndex < program.steps.length; stepIndex += 1) {
        const step = program.steps[stepIndex];
        const stepDuration = stepDurations[stepIndex];
        if (stepStart + stepDuration <= now) {
          stepStart += stepDuration;
          continue;
        }
        const groups = candidateGroups(program, roundIndex, stepIndex, stepStart, randomSeed, visibleOnly);
        const at = [...groups.keys()].filter((time) => time > now).sort((a, b) => a - b)[0];
        if (at !== void 0) {
          const candidates = groups.get(at);
          const winner = winnerFor(candidates);
          const isRoundEnd = stepIndex === program.steps.length - 1 && at === stepStart + stepDuration;
          const isStepEnd = at === stepStart + stepDuration;
          const offsetSeconds = isStepEnd ? void 0 : Math.round((at - stepStart) / SECOND_MS);
          const semantic = isStepEnd ? `${anchor}:${roundIndex}:${unifiedCueIdentity(step.id)}:end` : `${anchor}:${roundIndex}:${unifiedCueIdentity(step.id)}:${offsetSeconds}`;
          return {
            at,
            logicalId: `unified:${semantic}`,
            roundIndex,
            cycleIndex: roundIndex,
            stepIndex,
            stepId: step.id,
            ...offsetSeconds !== void 0 ? { offsetSeconds } : {},
            boundary: isStepEnd ? isRoundEnd ? "round-end" : "step-end" : "step-offset",
            isRoundEnd,
            candidates,
            winner,
            collision: candidates.length > 1,
            completesRun: false,
            showOnWatchFace: candidates.some((candidate) => candidate.showOnWatchFace)
          };
        }
        stepStart += stepDuration;
      }
      roundIndex += 1;
    }
    return null;
  }
  function nextUnifiedProgramEvent(program, anchor, now = Date.now(), startedAt = anchor, terminalAt = unifiedRunEndAt(program, anchor, startedAt), randomSeed = anchor, visibleOnly = false) {
    if (terminalAt !== null && now >= terminalAt) return null;
    const natural = program.noMainInterval ? unboundedBell(program, anchor, now, randomSeed, visibleOnly) : naturalEvent(program, anchor, now, randomSeed, visibleOnly);
    if (terminalAt === null || natural && natural.at < terminalAt) return natural;
    if (natural?.at === terminalAt) {
      if (!program.completionCue) return { ...natural, completesRun: true, showOnWatchFace: true };
      const winner2 = completionCandidate(program);
      return { ...natural, candidates: [winner2], winner: winner2, collision: false, completesRun: true, showOnWatchFace: true };
    }
    const winner = completionCandidate(program);
    const roundDuration = unifiedProgramDurationMs(program);
    return {
      at: terminalAt,
      logicalId: `unified:${anchor}:complete:${startedAt}:${terminalAt}`,
      roundIndex: program.noMainInterval ? 0 : Math.max(0, Math.floor((terminalAt - anchor) / roundDuration)),
      cycleIndex: program.noMainInterval ? 0 : Math.max(0, Math.floor((terminalAt - anchor) / roundDuration)),
      stepIndex: program.steps.length - 1,
      stepId: program.steps[program.steps.length - 1].id,
      boundary: "run-complete",
      isRoundEnd: false,
      candidates: [winner],
      winner,
      collision: false,
      completesRun: true,
      showOnWatchFace: true
    };
  }
  function unifiedTimelinePosition(program, anchor, now = Date.now(), startedAt = anchor, terminalAt = unifiedRunEndAt(program, anchor, startedAt), randomSeed = anchor) {
    if (program.noMainInterval) return {
      anchor,
      randomSeed,
      roundIndex: 0,
      cycleIndex: 0,
      roundProgress: 0,
      currentStepIndex: 0,
      currentStepId: program.steps[0].id,
      stepProgress: 0,
      nextEvent: nextUnifiedProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed)
    };
    const stepDurations = durations(program);
    const roundDuration = stepDurations.reduce((sum, value) => sum + value, 0);
    const roundIndex = roundAt(now, anchor, roundDuration);
    const roundStart = anchor + roundIndex * roundDuration;
    const roundElapsed = Math.max(0, now - roundStart);
    let accumulated = 0;
    let currentStepIndex = stepDurations.findIndex((value) => {
      accumulated += value;
      return roundElapsed < accumulated;
    });
    if (currentStepIndex < 0) currentStepIndex = program.steps.length - 1;
    const stepStartElapsed = stepDurations.slice(0, currentStepIndex).reduce((sum, value) => sum + value, 0);
    const stepDuration = stepDurations[currentStepIndex];
    return {
      anchor,
      randomSeed,
      roundIndex,
      cycleIndex: roundIndex,
      roundProgress: Math.max(0, Math.min(1, roundElapsed / roundDuration)),
      currentStepIndex,
      currentStepId: program.steps[currentStepIndex].id,
      stepProgress: Math.max(0, Math.min(1, (roundElapsed - stepStartElapsed) / stepDuration)),
      nextEvent: nextUnifiedProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed)
    };
  }
  function unifiedIterationEnd(program, anchor, now, count) {
    const duration = unifiedProgramDurationMs(program);
    const iterations = Math.max(1, Math.min(MAX_MUTE_ITERATIONS, Math.round(count)));
    const roundIndex = roundAt(now, anchor, duration);
    const endingRound = roundIndex + iterations - 1;
    const last = program.steps[program.steps.length - 1];
    return { logicalId: `unified:${anchor}:${endingRound}:${unifiedCueIdentity(last.id)}:end`, at: anchor + (endingRound + 1) * duration, iterations };
  }
  function unifiedSkipTarget(program, anchor, now, startedAt, terminalAt, direction) {
    if (program.steps.length < 2) return null;
    const position = unifiedTimelinePosition(program, anchor, now, startedAt, terminalAt);
    const index = position.currentStepIndex;
    const roundDuration = unifiedProgramDurationMs(program);
    if (direction === "previous" && index === 0 && position.roundIndex === 0 && terminalAt !== null) return null;
    const currentRoundEnd = anchor + (position.roundIndex + 1) * roundDuration;
    if (direction === "next" && index === program.steps.length - 1 && terminalAt !== null && currentRoundEnd >= terminalAt) return { anchor, startedAt, terminalAt, completesRun: true };
    const target = (index + (direction === "next" ? 1 : -1) + program.steps.length) % program.steps.length;
    const targetRound = direction === "next" && target === 0 ? position.roundIndex + 1 : direction === "previous" && index === 0 && position.roundIndex > 0 ? position.roundIndex - 1 : position.roundIndex;
    const before = durations(program).slice(0, target).reduce((sum, value) => sum + value, 0);
    const nextAnchor = now - targetRound * roundDuration - before;
    const delta = nextAnchor - anchor;
    const cycleBounded = program.runPolicy.kind === "cycles";
    return {
      anchor: nextAnchor,
      startedAt: cycleBounded ? startedAt + delta : startedAt,
      terminalAt: cycleBounded && terminalAt !== null ? terminalAt + delta : terminalAt,
      completesRun: false
    };
  }

  // src/lib/timeline.ts
  function cycleIndexAt(now, anchor, duration) {
    return Math.max(0, Math.floor((now - anchor) / duration));
  }
  function logicalId(mode, anchor, cycleIndex, boundary) {
    return `${mode}:${anchor}:${cycleIndex}:${boundary}`;
  }
  function winnerForCandidates(candidates) {
    return candidates.slice().sort(
      (left, right) => (right.cadenceSeconds ?? (right.cadenceMinutes ?? 0) * 60) - (left.cadenceSeconds ?? (left.cadenceMinutes ?? 0) * 60) || (left.trackOrder ?? Number.MAX_SAFE_INTEGER) - (right.trackOrder ?? Number.MAX_SAFE_INTEGER)
    )[0];
  }
  function unifiedRuntimeEvent(event, singleStep) {
    const candidates = event.candidates.map((candidate) => ({
      cueId: candidate.cueId,
      sourceCueId: candidate.sourceCueId,
      stepId: candidate.stepId,
      trackId: candidate.trackId,
      showOnWatchFace: candidate.showOnWatchFace,
      kind: candidate.kind === "sub-bell" ? "pattern-track" : candidate.kind === "step-end" ? singleStep ? "pattern-main" : "sequence-step" : "run-complete",
      alarmEnabled: candidate.alarmEnabled,
      occurrencesPerRound: candidate.occurrencesPerRound,
      sound: candidate.sound,
      volume: candidate.volume,
      sounds: candidate.sounds,
      soundMode: candidate.soundMode,
      hapticOverride: candidate.hapticOverride,
      cadenceSeconds: candidate.cadencePriority > 0 ? candidate.cadenceSeconds : void 0,
      trackOrder: candidate.trackOrder
    }));
    return {
      at: event.at,
      logicalId: event.logicalId,
      cycleIndex: event.roundIndex,
      stepId: event.stepId,
      stepIndex: event.stepIndex,
      boundary: event.boundary === "step-offset" ? "pattern-offset" : event.boundary === "step-end" ? singleStep ? "pattern-main" : "sequence-step" : event.boundary === "round-end" ? singleStep ? "pattern-main" : "sequence-cycle" : "run-complete",
      candidates,
      winner: candidates[event.candidates.indexOf(event.winner)],
      collision: event.collision,
      completesRun: event.completesRun,
      showOnWatchFace: event.showOnWatchFace
    };
  }
  function nextPatternEvent(program, anchor, now = Date.now(), randomSeed = anchor) {
    const duration = patternDurationSeconds(program) * 1e3;
    let cycleIndex = cycleIndexAt(now, anchor, duration);
    while (true) {
      const cycleStart = anchor + cycleIndex * duration;
      const candidatesByTime = /* @__PURE__ */ new Map();
      const mainAt = cycleStart + duration;
      candidatesByTime.set(mainAt, [{
        cueId: "main",
        kind: "pattern-main",
        sound: program.mainCue.sound,
        volume: program.mainCue.volume,
        sounds: program.mainCue.sounds,
        soundMode: program.mainCue.soundMode,
        hapticOverride: program.mainCue.hapticOverride
      }]);
      if (program.subBellsEnabled !== false) program.tracks.forEach((track, trackOrder) => {
        if (!track.enabled) return;
        trackEventOffsetsSeconds(track, duration / 1e3, cycleIndex, randomSeed).forEach((offsetSeconds) => {
          const at2 = cycleStart + offsetSeconds * 1e3;
          if (at2 >= mainAt) return;
          const candidates = candidatesByTime.get(at2) ?? [];
          candidates.push({
            cueId: track.id,
            kind: "pattern-track",
            sound: track.sound,
            volume: track.volume,
            sounds: track.sounds,
            soundMode: track.soundMode,
            hapticOverride: track.hapticOverride,
            ...track.repeatEnabled === false ? {} : { cadenceMinutes: track.cadenceMinutes, cadenceSeconds: trackCadenceSeconds(track) },
            trackOrder
          });
          candidatesByTime.set(at2, candidates);
        });
      });
      const at = [...candidatesByTime.keys()].filter((time) => time > now).sort((a, b) => a - b)[0];
      if (at !== void 0) {
        const candidates = candidatesByTime.get(at);
        const winner = candidates[0].kind === "pattern-main" ? candidates[0] : winnerForCandidates(candidates);
        const offsetSeconds = Math.round((at - cycleStart) / 1e3);
        const boundary = winner.kind === "pattern-main" ? "main" : offsetSeconds % 60 === 0 ? `offset:${offsetSeconds / 60}` : `offset-seconds:${offsetSeconds}`;
        return {
          at,
          logicalId: logicalId("pattern", anchor, cycleIndex, boundary),
          cycleIndex,
          boundary: winner.kind === "pattern-main" ? "pattern-main" : "pattern-offset",
          candidates,
          winner,
          collision: candidates.length > 1,
          completesRun: false
        };
      }
      cycleIndex += 1;
    }
  }
  function nextSequenceEvent(program, anchor, now = Date.now()) {
    const offsets = program.steps.reduce((values, step) => [...values, (values.at(-1) ?? 0) + sequenceStepDurationSeconds(step) * 1e3], []);
    const cycleDuration = offsets.at(-1);
    if (!cycleDuration) throw new Error("Sequence requires at least one positive-duration step");
    let cycleIndex = cycleIndexAt(now, anchor, cycleDuration);
    while (true) {
      const cycleStart = anchor + cycleIndex * cycleDuration;
      const stepIndex = offsets.findIndex((offset) => cycleStart + offset > now);
      if (stepIndex >= 0) {
        const step = program.steps[stepIndex];
        const at = cycleStart + offsets[stepIndex];
        const winner = { cueId: step.id, kind: "sequence-step", alarmEnabled: step.alarmEnabled === true, sound: step.sound, volume: step.volume, sounds: step.sounds, soundMode: step.soundMode, hapticOverride: step.hapticOverride };
        return {
          at,
          logicalId: logicalId("sequence", anchor, cycleIndex, `step:${stepIndex}`),
          cycleIndex,
          boundary: stepIndex === program.steps.length - 1 ? "sequence-cycle" : "sequence-step",
          candidates: [winner],
          winner,
          collision: false,
          completesRun: false
        };
      }
      cycleIndex += 1;
    }
  }
  function programCycleDurationMs(program) {
    if (program.mode === "unified") return unifiedProgramDurationMs(program);
    return program.mode === "pattern" ? patternDurationSeconds(program) * 1e3 : program.steps.reduce((total, step) => total + sequenceStepDurationSeconds(step) * 1e3, 0);
  }
  function currentStepEndAt(program, position) {
    const elapsed = program.mode === "pattern" ? patternDurationSeconds(program) * 1e3 : program.mode === "unified" ? program.steps.slice(0, (position.currentStepIndex ?? 0) + 1).reduce((sum, step) => sum + step.durationSeconds * 1e3, 0) : program.steps.slice(0, (position.currentStepIndex ?? 0) + 1).reduce((sum, step) => sum + sequenceStepDurationSeconds(step) * 1e3, 0);
    return position.anchor + position.cycleIndex * programCycleDurationMs(program) + elapsed;
  }
  function currentStepDurationMs(program, index) {
    if (program.mode === "pattern") return patternDurationSeconds(program) * 1e3;
    if (program.mode === "unified") return program.noMainInterval ? 0 : (program.steps[index]?.durationSeconds ?? 0) * 1e3;
    const step = program.steps[index];
    return step ? sequenceStepDurationSeconds(step) * 1e3 : 0;
  }
  function seekStepTarget(program, anchor, now, startedAt, terminalAt, fraction) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1 || terminalAt !== null && now >= terminalAt) return null;
    const position = timelinePosition(program, anchor, now, startedAt, terminalAt);
    const duration = currentStepDurationMs(program, position.currentStepIndex ?? 0);
    if (!duration) return null;
    const stepStart = currentStepEndAt(program, position) - duration;
    const delta = now - stepStart - Math.floor(duration * fraction);
    const cycleBounded = program.runPolicy.kind === "cycles";
    return {
      anchor: anchor + delta,
      startedAt: cycleBounded ? startedAt + delta : startedAt,
      terminalAt: cycleBounded && terminalAt !== null ? terminalAt + delta : terminalAt,
      completesRun: false
    };
  }
  function runEndAt(program, anchor, startedAt) {
    if (program.mode === "unified") return unifiedRunEndAt(program, anchor, startedAt);
    if (program.runPolicy.kind === "continuous") return null;
    if (program.runPolicy.kind === "duration") return startedAt + program.runPolicy.durationSeconds * 1e3;
    const duration = programCycleDurationMs(program);
    const firstBoundary = anchor + (Math.floor((startedAt - anchor) / duration) + 1) * duration;
    return firstBoundary + (program.runPolicy.cycleCount - 1) * duration;
  }
  function completionCandidate2(program) {
    const cue = program.completionCue ?? (program.mode === "pattern" ? program.mainCue : program.steps.at(-1));
    return { cueId: "completion", kind: "run-complete", sound: cue.sound, volume: cue.volume, sounds: cue.sounds, soundMode: cue.soundMode, hapticOverride: cue.hapticOverride };
  }
  function nextProgramEvent(program, anchor, now = Date.now(), startedAt = anchor, terminalAt = runEndAt(program, anchor, startedAt), randomSeed = anchor) {
    if (program.mode === "unified") {
      const event = nextUnifiedProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed);
      return event ? unifiedRuntimeEvent(event, program.steps.length === 1) : null;
    }
    const endAt = terminalAt;
    if (endAt !== null && now >= endAt) return null;
    const next = program.mode === "pattern" ? nextPatternEvent(program, anchor, now, randomSeed) : nextSequenceEvent(program, anchor, now);
    if (endAt === null || next.at < endAt) return next;
    if (next.at === endAt) {
      if (!program.completionCue) return { ...next, completesRun: true };
      const winner2 = completionCandidate2(program);
      return { ...next, candidates: [winner2], winner: winner2, collision: false, completesRun: true };
    }
    const winner = completionCandidate2(program);
    return {
      at: endAt,
      logicalId: `${program.mode}:${anchor}:complete:${startedAt}:${endAt}`,
      cycleIndex: Math.max(0, Math.floor((endAt - anchor) / programCycleDurationMs(program))),
      boundary: "run-complete",
      candidates: [winner],
      winner,
      collision: false,
      completesRun: true
    };
  }
  function timelinePosition(program, anchor, now = Date.now(), startedAt = anchor, terminalAt = runEndAt(program, anchor, startedAt), randomSeed = anchor) {
    if (program.mode === "unified") {
      const position = unifiedTimelinePosition(program, anchor, now, startedAt, terminalAt, randomSeed);
      return { mode: program.steps.length === 1 ? "pattern" : "sequence", anchor, randomSeed, cycleIndex: position.roundIndex, cycleProgress: position.roundProgress, currentStepIndex: position.currentStepIndex, stepProgress: position.stepProgress, nextEvent: position.nextEvent ? unifiedRuntimeEvent(position.nextEvent, program.steps.length === 1) : null };
    }
    const nextEvent = nextProgramEvent(program, anchor, now, startedAt, terminalAt, randomSeed);
    if (program.mode === "pattern") {
      const duration = patternDurationSeconds(program) * 1e3;
      const cycleIndex2 = cycleIndexAt(now, anchor, duration);
      const cycleStart2 = anchor + cycleIndex2 * duration;
      return { mode: "pattern", anchor, randomSeed, cycleIndex: cycleIndex2, cycleProgress: Math.max(0, Math.min(1, (now - cycleStart2) / duration)), nextEvent };
    }
    const offsets = program.steps.reduce((values, step) => [...values, (values.at(-1) ?? 0) + sequenceStepDurationSeconds(step) * 1e3], []);
    const total = offsets.at(-1);
    const cycleIndex = cycleIndexAt(now, anchor, total);
    const cycleStart = anchor + cycleIndex * total;
    const elapsed = Math.max(0, now - cycleStart);
    const currentStepIndex = offsets.findIndex((offset) => elapsed < offset);
    const previous = currentStepIndex === 0 ? 0 : offsets[currentStepIndex - 1];
    const stepDuration = offsets[currentStepIndex] - previous;
    return {
      mode: "sequence",
      anchor,
      randomSeed,
      cycleIndex,
      cycleProgress: Math.max(0, Math.min(1, elapsed / total)),
      currentStepIndex,
      stepProgress: Math.max(0, Math.min(1, (elapsed - previous) / stepDuration)),
      nextEvent
    };
  }
  function sequenceSkipTarget(program, anchor, now, startedAt, terminalAt, direction) {
    if (program.mode === "unified") return unifiedSkipTarget(program, anchor, now, startedAt, terminalAt, direction);
    if (program.steps.length < 2) return null;
    const position = timelinePosition(program, anchor, now, startedAt, terminalAt);
    const index = position.currentStepIndex ?? 0;
    if (direction === "previous" && index === 0 && position.cycleIndex === 0 && terminalAt !== null) return null;
    if (direction === "next" && index === program.steps.length - 1 && terminalAt !== null && position.nextEvent?.completesRun) {
      return { anchor, startedAt, terminalAt, completesRun: true };
    }
    const target = (index + (direction === "next" ? 1 : -1) + program.steps.length) % program.steps.length;
    const targetCycle = direction === "next" && target === 0 ? position.cycleIndex + 1 : direction === "previous" && index === 0 && position.cycleIndex > 0 ? position.cycleIndex - 1 : position.cycleIndex;
    const before = program.steps.slice(0, target).reduce((sum, step) => sum + sequenceStepDurationSeconds(step) * 1e3, 0);
    const nextAnchor = now - targetCycle * programCycleDurationMs(program) - before;
    const delta = nextAnchor - anchor;
    const cycleBounded = program.runPolicy.kind === "cycles";
    return {
      anchor: nextAnchor,
      startedAt: cycleBounded ? startedAt + delta : startedAt,
      terminalAt: cycleBounded && terminalAt !== null ? terminalAt + delta : terminalAt,
      completesRun: false
    };
  }

  // src/lib/activeHours.ts
  function effectiveAvailabilityForProgram(program, availability2) {
    return program.runPolicy.kind === "continuous" ? availability2 : { enabled: false, weeklyWindows: [], overrides: [] };
  }
  function minuteOfDay(timestamp) {
    const date = new Date(timestamp);
    return date.getHours() * 60 + date.getMinutes();
  }
  function normalizeMinute(value) {
    return (Math.round(value) % 1440 + 1440) % 1440;
  }
  function isLegacy(settings) {
    return "activeHoursEnabled" in settings;
  }
  function policyFor(settings) {
    if (!isLegacy(settings)) return settings;
    return {
      enabled: settings.activeHoursEnabled,
      weeklyWindows: [{
        id: "legacy-active-hours",
        enabled: true,
        startMinutes: settings.activeHoursStart,
        endMinutes: settings.activeHoursEnd,
        days: settings.activeHoursDays,
        behavior: "active"
      }],
      overrides: []
    };
  }
  function isDayEnabled(window, day) {
    return (window.days & 127 & 1 << day) !== 0;
  }
  function isWithinWindow(window, timestamp) {
    if (!window.enabled) return false;
    const start = normalizeMinute(window.startMinutes);
    const end = normalizeMinute(window.endMinutes);
    const date = new Date(timestamp);
    const minute = minuteOfDay(timestamp);
    if (start === end) return isDayEnabled(window, date.getDay());
    if (start < end) return isDayEnabled(window, date.getDay()) && minute >= start && minute < end;
    if (minute >= start) return isDayEnabled(window, date.getDay());
    if (minute < end) return isDayEnabled(window, (date.getDay() + 6) % 7);
    return false;
  }
  function matchingOverride(overrides, timestamp, behavior) {
    return overrides.some((override) => override.behavior === behavior && override.startAt <= timestamp && timestamp < override.endAt);
  }
  function isWithinActiveHours(settings, timestamp = Date.now()) {
    const policy = policyFor(settings);
    const weeklyActive = !policy.enabled || policy.weeklyWindows.some((window) => (window.behavior ?? "active") === "active" && isWithinWindow(window, timestamp));
    const weeklyQuiet = policy.enabled && policy.weeklyWindows.some((window) => window.behavior === "mute" && isWithinWindow(window, timestamp));
    const active = weeklyActive || matchingOverride(policy.overrides, timestamp, "active");
    return active && !weeklyQuiet && !matchingOverride(policy.overrides, timestamp, "mute");
  }
  function isCueAllowedByActiveHours(settings, cueAt) {
    const policy = policyFor(settings);
    if (isWithinActiveHours(policy, cueAt)) return true;
    if (matchingOverride(policy.overrides, cueAt, "mute")) return false;
    return Number.isFinite(cueAt) && isWithinActiveHours(policy, cueAt - 1);
  }
  function weeklyBoundary(window, timestamp, dayOffset, edge) {
    const start = normalizeMinute(window.startMinutes);
    const end = normalizeMinute(window.endMinutes);
    const boundaryMinute = start === end ? 0 : edge === "start" ? start : end;
    const candidate = new Date(timestamp);
    candidate.setHours(Math.floor(boundaryMinute / 60), boundaryMinute % 60, 0, 0);
    const isOvernightEnd = edge === "end" && start > end;
    candidate.setDate(candidate.getDate() + dayOffset + (isOvernightEnd ? 1 : 0));
    return candidate.getTime();
  }
  function nextActiveHoursStart(settings, timestamp = Date.now()) {
    const policy = policyFor(settings);
    if (isWithinActiveHours(policy, timestamp)) return timestamp;
    const candidates = /* @__PURE__ */ new Set();
    for (const override of policy.overrides) {
      if (override.startAt > timestamp) candidates.add(override.startAt);
      if (override.endAt > timestamp) candidates.add(override.endAt);
    }
    for (const window of policy.weeklyWindows) {
      if (!policy.enabled || !window.enabled || (window.days & 127) === 0) continue;
      for (let dayOffset = -1; dayOffset <= 8; dayOffset += 1) {
        const start = weeklyBoundary(window, timestamp, dayOffset, "start");
        if (start > timestamp && isDayEnabled(window, new Date(start).getDay())) candidates.add(start);
        const end = weeklyBoundary(window, timestamp, dayOffset, "end");
        const startDay = new Date(start).getDay();
        if (end > timestamp && isDayEnabled(window, startDay)) candidates.add(end);
      }
    }
    const sorted = [...candidates].sort((left, right) => left - right);
    return sorted.find((candidate) => isWithinActiveHours(policy, candidate)) ?? 0;
  }

  // src/lib/runtimeV2.ts
  function cycleIndexAt2(now, anchor, cycleMs) {
    return Math.max(0, Math.floor((now - anchor) / cycleMs));
  }
  function iterationMuteFor(program, anchor, now, count) {
    if (program.mode === "unified") {
      const end = unifiedIterationEnd(program, anchor, now, count);
      return { endsAtLogicalId: end.logicalId, endsAt: end.at, iterations: end.iterations };
    }
    const iterations = Math.max(1, Math.min(99, Math.round(count)));
    if (program.mode === "pattern") {
      const cycleMs2 = patternDurationSeconds(program) * 1e3;
      const currentCycle2 = cycleIndexAt2(now, anchor, cycleMs2);
      const nextMainCycle = anchor + (currentCycle2 + 1) * cycleMs2 <= now ? currentCycle2 + 1 : currentCycle2;
      const endingCycle2 = nextMainCycle + iterations - 1;
      return { endsAtLogicalId: `pattern:${anchor}:${endingCycle2}:main`, endsAt: anchor + (endingCycle2 + 1) * cycleMs2, iterations };
    }
    const cycleMs = program.steps.reduce((total, step) => total + sequenceStepDurationSeconds(step) * 1e3, 0);
    const currentCycle = cycleIndexAt2(now, anchor, cycleMs);
    const nextCycle = anchor + (currentCycle + 1) * cycleMs <= now ? currentCycle + 1 : currentCycle;
    const endingCycle = nextCycle + iterations - 1;
    return {
      endsAtLogicalId: `sequence:${anchor}:${endingCycle}:step:${program.steps.length - 1}`,
      endsAt: anchor + (endingCycle + 1) * cycleMs,
      iterations
    };
  }
  function gateProgramAudio(options) {
    const { event, now, masterVolume, mute, alarmBehavior, callActive } = options;
    const normalizedMute = mute.mutedUntil > 0 && now >= mute.mutedUntil ? { mutedUntil: 0, iteration: mute.iteration } : mute;
    const isMain = event.boundary === "pattern-main";
    const continuousAlarmRequested = !event.completesRun && (isMain && alarmBehavior !== "off" || event.winner.alarmEnabled === true);
    const consumesOnce = isMain && !event.completesRun && alarmBehavior === "once";
    const consumedAlarmBehavior = event.completesRun ? "off" : consumesOnce ? "off" : alarmBehavior;
    if (callActive && !continuousAlarmRequested) {
      return { shouldPlay: false, disposition: "suppressed", reason: "call-active", nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false };
    }
    if (masterVolume <= 0) {
      return { shouldPlay: false, disposition: "suppressed", reason: "master-muted", nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false };
    }
    if (normalizedMute.mutedUntil > now) {
      return { shouldPlay: false, disposition: "suppressed", reason: "timed-mute", nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false };
    }
    const iteration = normalizedMute.iteration;
    if (iteration) {
      if (event.logicalId === iteration.endsAtLogicalId || event.at > iteration.endsAt) {
        return { shouldPlay: true, disposition: continuousAlarmRequested ? "continuous-alarm" : "one-shot", reason: "none", nextMute: { mutedUntil: 0 }, nextAlarmBehavior: consumedAlarmBehavior, consumeAlarmOnce: consumesOnce };
      }
      return { shouldPlay: false, disposition: "suppressed", reason: "iteration-mute", nextMute: normalizedMute, nextAlarmBehavior: alarmBehavior, consumeAlarmOnce: false };
    }
    return {
      shouldPlay: true,
      disposition: continuousAlarmRequested ? "continuous-alarm" : "one-shot",
      reason: "none",
      nextMute: normalizedMute,
      nextAlarmBehavior: consumedAlarmBehavior,
      consumeAlarmOnce: consumesOnce
    };
  }

  // src/lib/ios-timer-kernel.ts
  var IOS_NOTIFICATION_BUDGET = 56;
  var IOS_MAX_PLANNING_MS = 24 * 60 * 60 * 1e3;
  var MAX_SCAN = 2e4;
  function programFor(config) {
    const result = parseUnifiedTimerProgram(config.timerV2Program);
    if (!result.ok) throw new Error(`Invalid iOS timer program: ${result.reason}`);
    return result.value;
  }
  function validateIOSRun(run) {
    try {
      if (!run.id || run.id.length > 200 || !run.name || run.name.length > 200) return false;
      programFor(run.config);
      return [run.config.timerV2Anchor, run.config.timerV2StartedAt].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0) && Number.isFinite(run.config.volume) && run.config.volume >= 0 && run.config.volume <= 1 && [run.config.timerV2EndsAt, run.config.timerV2PausedAt, run.config.mutedUntil].every((value) => value === void 0 || Number.isSafeInteger(value) && value >= 0);
    } catch {
      return false;
    }
  }
  function muteFor(config) {
    return {
      mutedUntil: config.mutedUntil ?? 0,
      ...config.mutedIterationEndId && config.mutedIterationEndAt ? {
        iteration: { endsAtLogicalId: config.mutedIterationEndId, endsAt: config.mutedIterationEndAt, iterations: config.mutedIterationCount ?? 1 }
      } : {}
    };
  }
  function alarmFor(config) {
    return config.alarmModeEnabled ? "locked" : config.alarmOnceArmed ? "once" : "off";
  }
  function withGate(config, mute, alarm) {
    return {
      ...config,
      alarmModeEnabled: alarm === "locked",
      alarmOnceArmed: alarm === "once",
      mutedUntil: mute.mutedUntil,
      mutedIterationEndId: mute.iteration?.endsAtLogicalId,
      mutedIterationEndAt: mute.iteration?.endsAt,
      mutedIterationCount: mute.iteration?.iterations ?? 0
    };
  }
  function availability(config, program) {
    const value = config.availabilityPolicy ? JSON.parse(config.availabilityPolicy) : { enabled: false, weeklyWindows: [], overrides: [] };
    return effectiveAvailabilityForProgram(program, value);
  }
  function iosRunState(run, now) {
    const c = run.config;
    const p = programFor(c);
    const paused = c.timerV2PausedAt ?? 0;
    const time = paused || now;
    const active = !(c.timerV2EndsAt && (p.runPolicy.kind === "until" ? now : time) >= c.timerV2EndsAt);
    const next = active ? nextProgramEvent(p, c.timerV2Anchor, time, c.timerV2StartedAt, c.timerV2EndsAt || null, c.timerV2RandomSeed ?? c.timerV2Anchor) : null;
    const position = timelinePosition(p, c.timerV2Anchor, time, c.timerV2StartedAt, c.timerV2EndsAt || null, c.timerV2RandomSeed ?? c.timerV2Anchor);
    const step = p.steps[position.currentStepIndex ?? 0];
    return {
      ...c,
      active,
      ringing: false,
      nextEventAt: paused ? 0 : next?.at ?? 0,
      nextLogicalId: next?.logicalId ?? "",
      mutedIterationsRemaining: c.mutedIterationEndAt && c.mutedIterationEndAt > time ? c.mutedIterationCount ?? 1 : 0,
      currentStepName: p.steps.length > 1 ? step.label : "",
      currentStepEndAt: currentStepEndAt(p, position),
      stepIndex: position.currentStepIndex ?? 0,
      activeHoursResumeAt: nextActiveHoursStart(availability(c, p), time)
    };
  }
  function soundID(sound) {
    return sound.kind === "builtin" ? sound.id : sound.uri;
  }
  function hash(value) {
    let h = 2166136261;
    for (let index = 0; index < value.length; index++) h = Math.imul(h ^ value.charCodeAt(index), 16777619);
    return h >>> 0;
  }
  function projected(run, event) {
    const c = run.config, p = programFor(c);
    const gate = gateProgramAudio({ event, now: event.at, masterVolume: c.volume, mute: muteFor(c), alarmBehavior: alarmFor(c), callActive: false });
    const allowed = isCueAllowedByActiveHours(availability(c, p), event.at);
    const alarm = gate.disposition === "continuous-alarm";
    const sounds = cueSounds(event.winner);
    const soundState = { sequence: { ...run.soundState?.sequence }, randomPrevious: { ...run.soundState?.randomPrevious } };
    let index = 0;
    if (sounds.length > 1 && event.winner.soundMode === "random") {
      const choices = sounds.map((_, index2) => index2).filter((index2) => index2 !== soundState.randomPrevious[event.winner.cueId]);
      index = choices[hash(`${event.logicalId}:${event.winner.cueId}:${c.timerV2RandomSeed}`) % choices.length];
      soundState.randomPrevious[event.winner.cueId] = index;
    } else if (sounds.length > 1 && event.winner.soundMode === "sequence") {
      index = (soundState.sequence[event.winner.cueId] ?? 0) % sounds.length;
      soundState.sequence[event.winner.cueId] = (index + 1) % sounds.length;
    }
    const position = timelinePosition(p, c.timerV2Anchor, event.at, c.timerV2StartedAt, c.timerV2EndsAt || null, c.timerV2RandomSeed);
    const cap = event.boundary === "sequence-step" || event.boundary === "sequence-cycle" ? currentStepEndAt(p, position) : Infinity;
    const volume = c.volume * (alarm ? c.alarmVolume ?? 1 : event.winner.volume);
    return {
      runId: run.id,
      name: run.name,
      event,
      alarm,
      audible: allowed && gate.shouldPlay && volume > 0,
      volume,
      soundId: alarm ? c.alarmSoundId ?? "alarm-tone" : soundID(sounds[index]),
      rarity: event.completesRun ? Number.MAX_SAFE_INTEGER : event.winner.occurrencesPerRound ? programCycleDurationMs(p) / event.winner.occurrencesPerRound : event.winner.cadenceSeconds ? event.winner.cadenceSeconds * 1e3 : programCycleDurationMs(p),
      winner: false,
      label: p.steps[event.stepIndex ?? 0]?.label ?? run.name,
      alarmExpiresAt: Math.min(event.at + c.alarmDurationSeconds * 1e3, cap, c.timerV2EndsAt || Infinity),
      nextConfig: withGate(c, gate.nextMute, gate.nextAlarmBehavior),
      nextSoundState: soundState
    };
  }
  function iosEventBatches(runs, after, batchLimit = IOS_NOTIFICATION_BUDGET, through = after + IOS_MAX_PLANNING_MS) {
    const working = runs.filter(validateIOSRun).filter((run) => !run.config.timerV2PausedAt).map((run) => ({ ...run, config: { ...run.config } }));
    let cursor = after, scans = 0;
    const batches = [];
    while (batches.length < Math.max(1, Math.min(64, batchLimit)) && scans++ < MAX_SCAN) {
      const upcoming = working.map((run) => {
        const c = run.config;
        return { run, event: nextProgramEvent(programFor(c), c.timerV2Anchor, cursor, c.timerV2StartedAt, c.timerV2EndsAt || null, c.timerV2RandomSeed ?? c.timerV2Anchor) };
      }).filter((value) => value.event !== null);
      if (!upcoming.length) break;
      const at = Math.min(...upcoming.map((value) => value.event.at));
      if (at > through) break;
      const batch = upcoming.filter((value) => value.event.at === at).map(({ run, event }) => projected(run, event));
      const winner = batch.filter((value) => value.audible).sort((a, b) => Number(b.alarm) - Number(a.alarm) || b.rarity - a.rarity || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))[0];
      if (winner) winner.winner = true;
      batch.forEach((item) => {
        const run = working.find((run2) => run2.id === item.runId);
        run.config = item.nextConfig;
        if (item.winner && !item.alarm) run.soundState = item.nextSoundState;
      });
      batches.push(batch);
      cursor = at;
    }
    return { batches, coveredThrough: cursor, truncated: batches.length >= batchLimit || scans >= MAX_SCAN };
  }
  function iosRunAction(run, action, amount, now) {
    const p = programFor(run.config), c = { ...run.config };
    const time = c.timerV2PausedAt || now;
    if (action === "pause") {
      if (!c.timerV2PausedAt) c.timerV2PausedAt = now;
      if (p.alignment.kind === "local-clock") c.timerV2Program = JSON.stringify({ ...p, alignment: { kind: "elapsed" } });
    } else if (action === "resume") {
      if (c.timerV2PausedAt) {
        const shift = now - c.timerV2PausedAt;
        c.timerV2Anchor += shift;
        c.timerV2StartedAt += shift;
        if (c.timerV2EndsAt && p.runPolicy.kind !== "until") c.timerV2EndsAt += shift;
        if (c.mutedIterationEndAt) c.mutedIterationEndAt += shift;
        c.timerV2PausedAt = 0;
      }
    } else if (action === "mute-seconds") return { ...run, config: withGate(c, { mutedUntil: now + Math.max(1, Math.min(86400, amount)) * 1e3 }, alarmFor(c)) };
    else if (action === "mute-iterations") return { ...run, config: withGate(c, { mutedUntil: 0, iteration: iterationMuteFor(p, c.timerV2Anchor, time, amount) }, alarmFor(c)) };
    else if (action === "clear-mute") return { ...run, config: withGate(c, { mutedUntil: 0 }, alarmFor(c)) };
    else if (action === "alarm-once") c.alarmOnceArmed = !c.alarmOnceArmed;
    else if (action.startsWith("toggle-step-alarm:")) {
      const id = action.slice("toggle-step-alarm:".length);
      if (p.noMainInterval || !p.steps.some((step) => step.id === id)) return null;
      c.timerV2Program = JSON.stringify({ ...p, steps: p.steps.map((step) => step.id === id ? { ...step, endAlarmEnabled: !step.endAlarmEnabled } : step) });
    } else {
      let target;
      if (action.startsWith("seek-step:")) target = seekStepTarget(p, c.timerV2Anchor, time, c.timerV2StartedAt, c.timerV2EndsAt || null, Number(action.slice(10)) / 1e4);
      else {
        const distance = action === "next-step" ? 1 : action === "previous-step" ? -1 : action.startsWith("skip-steps:") ? Number(action.slice(11)) : NaN;
        if (!Number.isInteger(distance) || !distance || Math.abs(distance) > 64) return null;
        let a = c.timerV2Anchor, start = c.timerV2StartedAt, end = c.timerV2EndsAt || null;
        for (let count = 0; count < Math.abs(distance); count++) {
          target = sequenceSkipTarget(p, a, time, start, end, distance > 0 ? "next" : "previous");
          if (!target) return null;
          a = target.anchor;
          start = target.startedAt;
          end = target.terminalAt;
          if (target.completesRun) break;
        }
      }
      if (!target) return null;
      c.timerV2Anchor = target.anchor;
      c.timerV2StartedAt = target.startedAt;
      c.timerV2EndsAt = target.terminalAt ?? 0;
      c.mutedIterationEndId = void 0;
      c.mutedIterationEndAt = void 0;
      c.mutedIterationCount = 0;
    }
    return { ...run, config: c };
  }
  function invokeIOSKernel(request) {
    const input = JSON.parse(request);
    const result = input.method === "validate" ? validateIOSRun(input.run) : input.method === "state" ? iosRunState(input.run, input.now) : input.method === "action" ? iosRunAction(input.run, input.action, input.amount ?? 0, input.now) : input.method === "plan" ? iosEventBatches(input.runs, input.after, input.limit, input.through) : (() => {
      throw new Error("Unknown iOS kernel method");
    })();
    return JSON.stringify(result);
  }
  return __toCommonJS(ios_timer_kernel_exports);
})();
