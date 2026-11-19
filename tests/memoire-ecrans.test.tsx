import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { memoriserMoi, oublierMoi, useMoi } from '../src/ecrans/mur/useMoi';
import { oublierMemoireMur, useMur } from '../src/ecrans/mur/useMur';
import { useRattrapage } from '../src/ecrans/mur/useRattrapage';
import { ecouterMur } from '../src/matrix/mur';
import { lireProfil, lireProfilClient } from '../src/matrix/profil';
import { lireSession } from '../src/matrix/session';
import { clientEcran, coupureReseau, differe } from './faux-ecran';

// Jamais le vrai serveur : le Mur, les profils et la session sont simulés.
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));
vi.mock('../src/matrix/profil', () => ({ lireProfil: vi.fn(), lireProfilClient: vi.fn() }));
vi.mock('../src/matrix/mur', () => ({ ecouterMur: vi.fn() }));

const SESSION = { userId: '@moi:sia', accessToken: 'jeton', deviceId: 'A' };
const AUTRE_SESSION = { userId: '@autre:sia', accessToken: 'jeton', deviceId: 'B' };
const PRESTA = {
  ok: true as const,
  profil: {
    version: 1 as const,
    role: 'prestataire' as const,
    pseudo: 'cocotier-7',
    metier: 'Plombier',
    zone: 'Akanda',
    modalite: 'deplace' as const,
    services: [],
  },
};

function Moi() {
  const { moi, chargement } = useMoi();
  return <p>{chargement ? 'en lecture' : moi ? `${moi.role} ${moi.pseudo}` : 'sans profil'}</p>;
}

describe('« Qui je suis » reste en mémoire d’un écran à l’autre', () => {
  beforeEach(() => {
    oublierMoi();
    vi.mocked(lireSession).mockReturnValue(SESSION);
    vi.mocked(lireProfil).mockReset().mockResolvedValue(PRESTA);
    vi.mocked(lireProfilClient).mockReset().mockResolvedValue({ ok: true, profil: null });
  });

  it('première fois : lecture, puis le profil', async () => {
    render(<Moi />);
    expect(screen.getByText('en lecture')).toBeInTheDocument();
    expect(await screen.findByText('prestataire cocotier-7')).toBeInTheDocument();
  });

  it('fois suivantes : connu tout de suite, sans attendre le serveur', async () => {
    const { unmount } = render(<Moi />);
    await screen.findByText('prestataire cocotier-7');
    unmount();
    // Le serveur ne répond plus.
    vi.mocked(lireProfil).mockReturnValue(new Promise(() => undefined));
    render(<Moi />);
    expect(screen.getByText('prestataire cocotier-7')).toBeInTheDocument();
  });

  it('une relecture met à jour ce qu’on savait', async () => {
    const { unmount } = render(<Moi />);
    await screen.findByText('prestataire cocotier-7');
    unmount();
    vi.mocked(lireProfil).mockResolvedValue({
      ok: true,
      profil: { ...PRESTA.profil, pseudo: 'cocotier-8' },
    });
    render(<Moi />);
    expect(screen.getByText('prestataire cocotier-7')).toBeInTheDocument();
    expect(await screen.findByText('prestataire cocotier-8')).toBeInTheDocument();
  });

  it('serveur injoignable pendant la relecture : on garde ce qu’on savait', async () => {
    const { unmount } = render(<Moi />);
    await screen.findByText('prestataire cocotier-7');
    unmount();
    const serveur = differe<{ ok: false; erreur: 'reseau' }>();
    vi.mocked(lireProfil).mockReturnValue(serveur.promesse);
    render(<Moi />);
    await act(async () => serveur.resoudre({ ok: false, erreur: 'reseau' }));
    expect(screen.getByText('prestataire cocotier-7')).toBeInTheDocument();
  });

  it('lecture qui échoue d’emblée (rien en mémoire) : on montre le Mur sans rôle', async () => {
    vi.mocked(lireProfil).mockRejectedValue(coupureReseau());
    render(<Moi />);
    expect(await screen.findByText('sans profil')).toBeInTheDocument();
  });

  it('profil enregistré à l’instant : les écrans suivants le savent tout de suite', () => {
    vi.mocked(lireProfil).mockReturnValue(new Promise(() => undefined));
    memoriserMoi(SESSION.userId, { role: 'client', pseudo: 'ibis-3', zone: 'Owendo' });
    render(<Moi />);
    expect(screen.getByText('client ibis-3')).toBeInTheDocument();
  });

  it('un profil client enregistré ne fait pas oublier un profil prestataire (même règle que la lecture)', () => {
    vi.mocked(lireProfil).mockReturnValue(new Promise(() => undefined));
    memoriserMoi(SESSION.userId, { role: 'prestataire', pseudo: 'cocotier-7', zone: 'Akanda' });
    memoriserMoi(SESSION.userId, { role: 'client', pseudo: 'ibis-3', zone: 'Owendo' });
    render(<Moi />);
    expect(screen.getByText('prestataire cocotier-7')).toBeInTheDocument();
  });

  it('la mémoire est propre à chaque compte', async () => {
    const { unmount } = render(<Moi />);
    await screen.findByText('prestataire cocotier-7');
    unmount();
    vi.mocked(lireSession).mockReturnValue(AUTRE_SESSION);
    vi.mocked(lireProfil).mockReturnValue(new Promise(() => undefined));
    render(<Moi />);
    expect(screen.getByText('en lecture')).toBeInTheDocument();
  });
});

describe('Le Mur reste en mémoire d’un écran à l’autre', () => {
  const CLIENT = clientEcran() as never;
  const STATUT = {
    eventId: '$p1',
    userId: '@mangue:sia',
    pseudo: 'mangue-douce',
    metier: 'Plombier',
    zone: 'Akanda',
    fin: Date.now() + 3_600_000,
  };
  let rappel: (m: { statuts: unknown[]; demandes: unknown[] }) => void = () => undefined;
  let echec: (e: unknown) => void = () => undefined;

  beforeEach(() => {
    oublierMemoireMur();
    vi.mocked(ecouterMur)
      .mockReset()
      .mockImplementation(((_c: unknown, surMur: typeof rappel, surErreur: typeof echec) => {
        rappel = surMur;
        echec = surErreur;
        return () => undefined;
      }) as never);
  });

  it('pas prêt tant que rien n’a été lu', () => {
    const { result } = renderHook(() => useMur(CLIENT));
    expect(result.current.pret).toBe(false);
    act(() => rappel({ statuts: [STATUT], demandes: [] }));
    expect(result.current.pret).toBe(true);
    expect(result.current.statuts).toHaveLength(1);
  });

  it('l’écran suivant a tout de suite ce qui vient d’être lu', () => {
    const premier = renderHook(() => useMur(CLIENT));
    act(() => rappel({ statuts: [STATUT], demandes: [] }));
    premier.unmount();

    const suivant = renderHook(() => useMur(CLIENT));
    expect(suivant.result.current.pret).toBe(true);
    expect(suivant.result.current.statuts).toEqual([STATUT]);
  });

  it('une lecture qui échoue ensuite ne cache pas ce qu’on savait', () => {
    const premier = renderHook(() => useMur(CLIENT));
    act(() => rappel({ statuts: [STATUT], demandes: [] }));
    premier.unmount();

    const suivant = renderHook(() => useMur(CLIENT));
    act(() => echec(coupureReseau()));
    expect(suivant.result.current.erreur).toBe(false);
    expect(suivant.result.current.statuts).toEqual([STATUT]);
  });

  it('première lecture qui échoue (rien en mémoire) : l’erreur est dite', () => {
    const { result } = renderHook(() => useMur(CLIENT));
    act(() => echec(coupureReseau()));
    expect(result.current.erreur).toBe(true);
    expect(result.current.pret).toBe(false);
  });

  it('un autre client (autre compte) ne voit jamais le Mur de l’ancien', () => {
    const premier = renderHook(() => useMur(CLIENT));
    act(() => rappel({ statuts: [STATUT], demandes: [] }));
    premier.unmount();

    const autre = renderHook(() => useMur(clientEcran() as never));
    expect(autre.result.current.pret).toBe(false);
    expect(autre.result.current.statuts).toEqual([]);
  });

  it('sans client : rien, pas d’erreur', () => {
    const { result } = renderHook(() => useMur(null));
    expect(result.current).toMatchObject({ pret: false, erreur: false, statuts: [] });
  });

  it('téléphone rallumé : l’heure se met à jour tout de suite, sans attendre la minuterie', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { result } = renderHook(() => useMur(CLIENT));
      act(() => rappel({ statuts: [STATUT], demandes: [] }));
      const avant = result.current.maintenant;
      vi.setSystemTime(avant + 2 * 3_600_000);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(result.current.maintenant).toBe(avant + 2 * 3_600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useRattrapage', () => {
  it('suit l’état de synchronisation du client', () => {
    const client = clientEcran();
    const { result } = renderHook(() => useRattrapage(client as never));
    expect(result.current).toBe(false);
    act(() => client.changerSynchro('CATCHUP'));
    expect(result.current).toBe(true);
    act(() => client.changerSynchro('RECONNECTING'));
    expect(result.current).toBe(true);
    act(() => client.changerSynchro('SYNCING'));
    expect(result.current).toBe(false);
    act(() => client.changerSynchro('ERROR'));
    expect(result.current).toBe(false);
  });

  it('sans client : jamais de mise à jour', () => {
    const { result } = renderHook(() => useRattrapage(null));
    expect(result.current).toBe(false);
  });

  it('se désabonne quand l’écran part', () => {
    const client = clientEcran();
    const retire = vi.spyOn(client, 'off');
    const { unmount } = renderHook(() => useRattrapage(client as never));
    unmount();
    expect(retire).toHaveBeenCalledTimes(1);
  });
});
