import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { vi } from 'vitest';

/*
 * Faux client Matrix pour les tests (aucun réseau). Seules les méthodes utilisées par src/matrix/ existent.
 * Les événements sont de vrais MatrixEvent du SDK (lecture des champs identique au vrai client).
 */

export const MOI = '@moi:sia.tail94dc60.ts.net';
export const AUTRE = '@autre:sia.tail94dc60.ts.net';
export const MUR = '!mur:sia.tail94dc60.ts.net';

type Options = {
  type: string;
  content?: Record<string, unknown>;
  sender?: string;
  id?: string;
  ts?: number;
  roomId?: string;
  stateKey?: string;
  redacted?: boolean;
  prevContent?: Record<string, unknown>;
};

let compteur = 0;

export function evenement(o: Options): MatrixEvent {
  compteur += 1;
  return new MatrixEvent({
    type: o.type,
    content: o.content ?? {},
    sender: o.sender ?? AUTRE,
    event_id: o.id ?? `$ev${compteur}`,
    origin_server_ts: o.ts ?? Date.now(),
    room_id: o.roomId ?? MUR,
    ...(o.stateKey !== undefined ? { state_key: o.stateKey } : {}),
    unsigned: {
      ...(o.redacted ? { redacted_because: { type: 'm.room.redaction' } } : {}),
      ...(o.prevContent ? { prev_content: o.prevContent } : {}),
    },
  } as never);
}

export type FauxMembre = { membership: string; typing?: boolean; event?: MatrixEvent };

export type FauxSalon = {
  roomId: string;
  appartenance: string;
  membres: Record<string, FauxMembre>;
  etat: Record<string, MatrixEvent>;
  evenements: MatrixEvent[];
  alias?: string;
  ts?: number;
  peutEffacer?: (ev: MatrixEvent) => boolean;
  /** Créateur du salon (expéditeur de m.room.create). */
  createur?: string;
};

export function salon(f: FauxSalon) {
  return {
    roomId: f.roomId,
    getMyMembership: () => f.appartenance,
    getMember: (id: string) => {
      const m = f.membres[id];
      return m
        ? { membership: m.membership, typing: m.typing ?? false, events: { member: m.event } }
        : null;
    },
    currentState: {
      getStateEvents: (type: string, cle: string) => (cle === '' ? (f.etat[type] ?? null) : null),
    },
    getLiveTimeline: () => ({
      getEvents: () => f.evenements,
      getState: () => ({
        maySendRedactionForEvent: (ev: MatrixEvent) => f.peutEffacer?.(ev) ?? true,
      }),
    }),
    hasEncryptionStateEvent: () => f.etat['m.room.encryption'] !== undefined,
    getLastActiveTimestamp: () => f.ts ?? 0,
    findEventById: (id: string) => f.evenements.find((e) => e.getId() === id),
    getCanonicalAlias: () => f.alias ?? null,
    getCreator: () => f.createur ?? null,
    getMembers: () =>
      Object.entries(f.membres).map(([userId, m]) => ({ userId, membership: m.membership })),
    getJoinedMemberCount: () =>
      Object.values(f.membres).filter((m) => m.membership === 'join').length,
    getInvitedMemberCount: () =>
      Object.values(f.membres).filter((m) => m.membership === 'invite').length,
    loadMembersIfNeeded: vi.fn(async () => true),
  };
}

export type FauxClient = ReturnType<typeof fauxClient>;

type Ecouteur = (...a: unknown[]) => void;

/** Petit émetteur d'événements (les types Node ne sont pas installés). */
export function emetteur() {
  const ecouteurs = new Map<string, Set<Ecouteur>>();
  return {
    on: (nom: string, f: Ecouteur) => {
      ecouteurs.set(nom, (ecouteurs.get(nom) ?? new Set()).add(f));
    },
    off: (nom: string, f: Ecouteur) => {
      ecouteurs.get(nom)?.delete(f);
    },
    emit: (nom: string, ...a: unknown[]) => {
      for (const f of [...(ecouteurs.get(nom) ?? [])]) f(...a);
    },
  };
}

/** Appareils (identifiants) de chaque compte, rendus par getCrypto().getUserDeviceInfo. */
export type FauxAppareils = Record<string, string[]>;

export function fauxClient(
  salons: ReturnType<typeof salon>[],
  chiffre = true,
  appareils: FauxAppareils = {},
) {
  const e = emetteur();
  let n = 0;
  /** Partage anticipé de la clé de salon (préchauffage) : les tests regardent s'il a été demandé. */
  const prepareToEncrypt = vi.fn();
  const c = {
    salons,
    prepareToEncrypt,
    getUserId: () => MOI,
    getRoom: (id: string) => salons.find((s) => s.roomId === id) ?? null,
    getRooms: () => salons,
    joinRoom: vi.fn(async (id: string) => salons.find((s) => s.roomId === id) ?? { roomId: MUR }),
    sendEvent: vi.fn(async () => ({ event_id: `$envoye${++n}` })),
    sendMessage: vi.fn(async () => ({ event_id: `$message${++n}` })),
    resendEvent: vi.fn(async () => ({ event_id: `$renvoye${++n}` })),
    redactEvent: vi.fn(async () => ({ event_id: `$efface${++n}` })),
    createRoom: vi.fn(async () => ({ room_id: '!bulle:sia.tail94dc60.ts.net' })),
    invite: vi.fn(async () => ({})),
    leave: vi.fn(async () => ({})),
    kick: vi.fn(async () => ({})),
    sendTyping: vi.fn(async () => ({})),
    paginateEventTimeline: vi.fn(async () => false),
    fetchRoomEvent: vi.fn(async () => ({})),
    getEventMapper: () => (brut: object) => new MatrixEvent(brut as never),
    appareils,
    getCrypto: () =>
      chiffre
        ? {
            isEncryptionEnabledInRoom: async () => true,
            prepareToEncrypt,
            getUserDeviceInfo: async (ids: string[]) =>
              new Map(
                ids.map((id) => [
                  id,
                  new Map((appareils[id] ?? []).map((d) => [d, { deviceId: d }])),
                ]),
              ),
          }
        : undefined,
    on: e.on,
    off: e.off,
    emit: e.emit,
  };
  return c;
}

export function comme(c: FauxClient): MatrixClient {
  return c as unknown as MatrixClient;
}
