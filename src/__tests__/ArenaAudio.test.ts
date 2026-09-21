import {describe, it, expect, vi} from 'vitest';
import {
  ArenaAudio, ARENA_CUES, ARENA_TRACKS, resolveCues, CUE_BASE_URL,
  type ArenaAudioSink,
} from '../../examples/10-arpg/ArenaAudio';

import type {ArenaEvent, ArenaEventType} from '../../examples/10-arpg/ArenaRun';
import {ArenaRun} from '../../examples/10-arpg/ArenaRun';


/**
 * The ARPG demo's event-to-sound policy.
 *
 * jsdom has no `AudioContext`, and even in a browser the interesting parts of
 * this are not audible: how many cues one frame may start, how long a cue type
 * must wait, which bed a phase owns. So `ArenaAudio` takes a sink interface and
 * this file hands it a recorder.
 *
 * The two limits are the reason the class exists. Four mobs dying in the same
 * frame is ordinary, and four copies of the same cue starting on the same sample
 * is a 4x amplitude spike rather than a chord.
 */

interface SfxCall {url: string; volume?: number; spatial?: unknown}

class RecordingSink implements ArenaAudioSink {
  sfx: SfxCall[] = [];
  bgm: Array<{url: string; fade?: number}> = [];
  stops: Array<number | undefined> = [];
  listener: Array<[number, number]> = [];

  playSfx(url: string, opts: {volume?: number; spatial?: unknown} = {}): unknown {
    this.sfx.push({url, volume: opts.volume, spatial: opts.spatial});
    return null;
  }

  updateListener(x: number, y: number): void { this.listener.push([x, y]); }
  playBgm(url: string, fade?: number): unknown { this.bgm.push({url, fade}); return undefined; }
  stopBgm(fade?: number): void { this.stops.push(fade); }
}

function at(type: ArenaEventType, x = 0, y = 0): ArenaEvent {
  return {type, x, y};
}

/** A sink and an instance whose first frame is already open. */
function ready(): {sink: RecordingSink; audio: ArenaAudio} {
  const sink = new RecordingSink();
  const audio = new ArenaAudio(sink);
  audio.beginFrame(0, 0, 0);
  return {sink, audio};
}

describe('ArenaAudio — cues', () => {
  it('answers every event type with its own cue', () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);
    const types = Object.keys(ARENA_CUES) as ArenaEventType[];

    // One event per frame, well apart, so neither limit is in play.
    for (const type of types) {
      audio.beginFrame(1, 0, 0);
      expect(audio.handle(at(type))).toBe(true);
    }
    expect(sink.sfx.map(call => call.url)).toEqual(types.map(type => ARENA_CUES[type].url));
    expect(sink.sfx.map(call => call.volume)).toEqual(types.map(type => ARENA_CUES[type].volume));
  });

  it('pans a cue that happened somewhere, and centres the run-wide ones', () => {

    const {sink, audio} = ready();
    audio.handle(at('kill', 3, 9));
    audio.handle(at('victory', 7, 7));

    expect(sink.sfx[0].spatial).toEqual({
      x: 3, y: 9,
      refDistance: ArenaAudio.REF_DISTANCE,
      maxDistance: ArenaAudio.MAX_DISTANCE,
    });
    expect(sink.sfx[1].spatial).toBeUndefined();
  });

  it('moves the listener onto whatever it is given', () => {
    const {sink, audio} = ready();
    audio.beginFrame(0.016, 4.5, 11.25);
    expect(sink.listener).toEqual([[0, 0], [4.5, 11.25]]);
  });
});

describe('ArenaAudio — the two limits', () => {
  it('starts at most four cues in one frame', () => {
    const {sink, audio} = ready();
    // Five different types, so the per-cue gap cannot be what stops the fifth.
    const types: ArenaEventType[] = ['hero-hit', 'hero-hurt', 'kill', 'wave-start', 'boss'];
    const played = types.map(type => audio.handle(at(type)));

    expect(played).toEqual([true, true, true, true, false]);
    expect(sink.sfx.length).toBe(ArenaAudio.VOICES_PER_FRAME);
  });

  it('refills the budget on the next frame', () => {
    const {sink, audio} = ready();
    for (const type of ['hero-hit', 'hero-hurt', 'kill', 'wave-start'] as ArenaEventType[]) {
      audio.handle(at(type));
    }
    expect(audio.handle(at('boss'))).toBe(false);

    audio.beginFrame(1 / 60, 0, 0);
    expect(audio.handle(at('boss'))).toBe(true);
    expect(sink.sfx.length).toBe(5);
  });

  it('drops a repeat of the same cue inside the gap, and allows it after', () => {
    const {sink, audio} = ready();
    expect(audio.handle(at('hero-hit'))).toBe(true);
    // Budget is untouched — three voices left — so only the gap can refuse this.
    expect(audio.handle(at('hero-hit'))).toBe(false);

    audio.beginFrame(ArenaAudio.CUE_INTERVAL / 2, 0, 0);
    expect(audio.handle(at('hero-hit'))).toBe(false);
    audio.beginFrame(ArenaAudio.CUE_INTERVAL, 0, 0);
    expect(audio.handle(at('hero-hit'))).toBe(true);
    expect(sink.sfx.length).toBe(2);
  });

  it('keeps its own clock inside the engine-wide dt rules', () => {
    const {audio} = ready();
    // A tab hidden for a minute must not retire every gap at once, and a
    // first-frame 0 or a backwards clock must not move time at all — the same
    // contract `FrameClock` holds the engine's modules to.
    audio.beginFrame(60, 0, 0);
    expect(audio.elapsed).toBe(0.1);
    audio.beginFrame(0, 0, 0);
    audio.beginFrame(-1, 0, 0);
    audio.beginFrame(Number.NaN, 0, 0);
    expect(audio.elapsed).toBe(0.1);
  });
});

describe('ArenaAudio — the bed', () => {
  it('gives each phase its track and stops on an ending', () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);

    audio.setPhase('ready');
    audio.setPhase('wave');
    audio.setPhase('intermission');
    audio.setPhase('boss');
    audio.setPhase('victory');

    expect(sink.bgm.map(call => call.url)).toEqual([
      ARENA_TRACKS.calm, ARENA_TRACKS.wave, ARENA_TRACKS.calm, ARENA_TRACKS.boss,
    ]);
    expect(sink.stops.length).toBe(1);
  });

  it('does not restart a bed that is already playing', () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);

    // `ready` and `intermission` share the calm bed, and a run passes through
    // that pair between every wave.
    audio.setPhase('ready');
    audio.setPhase('intermission');
    audio.setPhase('ready');
    expect(sink.bgm.length).toBe(1);
  });

  it('goes quiet when muted and picks the same bed back up', () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);
    audio.setPhase('wave');
    audio.beginFrame(0, 0, 0);

    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    expect(sink.stops.length).toBe(1);
    expect(audio.handle(at('kill'))).toBe(false);
    expect(sink.sfx).toEqual([]);
    // Muting twice is one mute.
    audio.setMuted(true);
    expect(sink.stops.length).toBe(1);

    audio.setMuted(false);
    expect(sink.bgm.map(call => call.url)).toEqual([ARENA_TRACKS.wave, ARENA_TRACKS.wave]);
    expect(audio.handle(at('kill'))).toBe(true);
  });

  it('has nothing to resume when unmuted during a result screen', () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);
    audio.setPhase('defeat');
    audio.setMuted(true);
    audio.setMuted(false);
    expect(sink.bgm).toEqual([]);
  });
});

describe('ArenaAudio — wired to a real run', () => {
  it('sounds a whole run without ever overrunning the budget', () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);
    const run = new ArenaRun({onEvent: event => audio.handle(event)});
    const DT = 1 / 60;

    run.start();
    let worstFrame = 0;
    let t = 0;
    while (!run.isOver && t < 240) {
      const before = sink.sfx.length;
      audio.beginFrame(DT, run.hero.position.x, run.hero.position.y);
      // The brawler policy from ArenaRun.test.ts, inlined: close in and swing.
      const target = run.nearestEnemy();
      const dx = target ? target.position.x - run.hero.position.x : 0;
      const dy = target ? target.position.y - run.hero.position.y : 0;
      const distance = Math.hypot(dx, dy);
      run.step(DT, distance > run.hero.attackRange * 0.8
        ? {x: dx / distance, y: dy / distance, attack: true}
        : {attack: true});
      worstFrame = Math.max(worstFrame, sink.sfx.length - before);
      t += DT;
    }

    expect(run.phase).toBe('victory');
    // The run is audible at all: hits, deaths and the boss cue all reached the sink.
    const urls = new Set(sink.sfx.map(call => call.url));
    expect(urls.has(ARENA_CUES['hero-hit'].url)).toBe(true);
    expect(urls.has(ARENA_CUES.kill.url)).toBe(true);
    expect(urls.has(ARENA_CUES.boss.url)).toBe(true);
    expect(worstFrame).toBeLessThanOrEqual(ArenaAudio.VOICES_PER_FRAME);
    // Ten kills over the run, but the gap collapses the ones that land together,
    // so the count is a lower bound rather than an equality.
    expect(sink.sfx.length).toBeGreaterThan(10);
  });
});

describe('ArenaAudio — the optional sound pack', () => {
  /** A manifest source whose files all load, recording what was asked for. */
  function pack(manifest: Record<string, unknown> | null, missing: string[] = []) {
    const asked: string[] = [];
    return {
      asked,
      source: {
        fetchJson: async () => manifest,
        preload: async (url: string) => {
          asked.push(url);
          if (missing.includes(url)) {throw new Error(`404 ${url}`);}
        },
      },
    };
  }

  it('keeps the synthesized table when no pack is installed', async () => {
    const {source, asked} = pack(null);
    // The committed manifest declares no cues, so this is the default path: it
    // must not cost one request per cue.
    expect(await resolveCues(source)).toBe(ARENA_CUES);
    expect(asked).toEqual([]);
  });

  it('substitutes only the cues a pack actually names', async () => {
    const {source, asked} = pack({'hero-hit': 'hit.mp3', kill: 'die.ogg'});
    const cues = await resolveCues(source);

    expect(asked).toEqual([`${CUE_BASE_URL}hit.mp3`, `${CUE_BASE_URL}die.ogg`]);
    expect(cues['hero-hit'].url).toBe(`${CUE_BASE_URL}hit.mp3`);
    expect(cues.kill.url).toBe(`${CUE_BASE_URL}die.ogg`);
    // Volume and panning are the demo's decision, not the pack's.
    expect(cues['hero-hit'].volume).toBe(ARENA_CUES['hero-hit'].volume);
    expect(cues.kill.spatial).toBe(ARENA_CUES.kill.spatial);
    // Everything else is untouched, and the shared table was not mutated.
    expect(cues.boss).toEqual(ARENA_CUES.boss);
    expect(ARENA_CUES['hero-hit'].url.startsWith('data:')).toBe(true);
  });

  it('falls back per cue, so a half-filled pack is not silence', async () => {
    // Failure is modelled as a rejecting preload rather than a 404 on purpose.
    // Checked against a real server: `vite preview` answers a missing file with
    // index.html and a 200, so what actually rejects is `decodeAudioData` being
    // handed HTML. A resolver that only tested `res.ok` would have shipped
    // broken.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const {source} = pack(
      {'hero-hit': 'hit.mp3', kill: 'missing.mp3'},
      [`${CUE_BASE_URL}missing.mp3`]
    );
    const cues = await resolveCues(source);

    expect(cues['hero-hit'].url).toBe(`${CUE_BASE_URL}hit.mp3`);
    expect(cues.kill).toEqual(ARENA_CUES.kill);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('ignores the manifest keys that are not cues', async () => {
    const {source, asked} = pack({
      _readme: 'prose that is not a filename',
      _example: {'hero-hit': 'nested.mp3'},
      unknownCue: 'nope.mp3',
      boss: 42,
      victory: '',
    });
    expect(await resolveCues(source)).toEqual(ARENA_CUES);
    expect(asked).toEqual([]);
  });

  it('passes an absolute path or a URL through unchanged', async () => {
    const {source, asked} = pack({
      'hero-hit': '/audio/shared/hit.mp3',
      kill: 'https://example.test/die.mp3',
      boss: 'boss.mp3',
    });
    await resolveCues(source);
    expect(asked).toEqual([
      '/audio/shared/hit.mp3',
      'https://example.test/die.mp3',
      `${CUE_BASE_URL}boss.mp3`,
    ]);
  });

  it('plays the substituted file once the table is swapped in', async () => {
    const sink = new RecordingSink();
    const audio = new ArenaAudio(sink);
    const {source} = pack({kill: 'die.mp3'});

    audio.beginFrame(0, 0, 0);
    audio.handle(at('kill'));
    audio.setCues(await resolveCues(source));
    audio.beginFrame(1, 0, 0);
    audio.handle(at('kill'));

    expect(sink.sfx.map(call => call.url))
      .toEqual([ARENA_CUES.kill.url, `${CUE_BASE_URL}die.mp3`]);
  });
});





