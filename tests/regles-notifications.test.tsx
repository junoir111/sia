import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { ReglesNotifications } from '../src/coquille/ReglesNotifications';
import type { Moi } from '../src/ecrans/mur/useMoi';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { useMoi } from '../src/ecrans/mur/useMoi';
import { reglerNotificationPrestataires } from '../src/matrix/notifications';

// Ni vrai serveur ni vrai client Matrix : on vérifie seulement QUI reçoit la règle, et quand.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/ecrans/mur/useMoi', () => ({ useMoi: vi.fn() }));
vi.mock('../src/matrix/notifications', () => ({
  reglerNotificationPrestataires: vi.fn(async () => undefined),
}));
vi.mock('../src/matrix/session', () => ({
  lireSession: () => ({ userId: '@puma:sia', accessToken: 'jeton', deviceId: 'APP' }),
}));

const CLIENT = { getUserId: () => '@puma:sia' } as unknown as MatrixClient;

function poser(moi: Moi | null, client: MatrixClient | null = CLIENT) {
  vi.mocked(useMatrix).mockReturnValue({ client, etat: client ? 'pret' : 'demarrage' });
  vi.mocked(useMoi).mockReturnValue({ moi, userId: '@puma:sia', chargement: false });
  return render(<ReglesNotifications />);
}

beforeEach(() => {
  vi.mocked(reglerNotificationPrestataires).mockClear();
});

describe('Règle « un prestataire se rend disponible »', () => {
  it('client : la règle est posée à l’ouverture', async () => {
    poser({ role: 'client', pseudo: 'Puma', zone: 'Akanda' });
    await waitFor(() => expect(reglerNotificationPrestataires).toHaveBeenCalledWith(CLIENT, true));
  });

  it('prestataire : la règle est retirée (il n’est pas dérangé par ses confrères)', async () => {
    poser({ role: 'prestataire', pseudo: 'Puma', zone: 'Akanda' });
    await waitFor(() => expect(reglerNotificationPrestataires).toHaveBeenCalledWith(CLIENT, false));
  });

  it('rôle inconnu (profil pas encore enregistré, serveur muet) : on ne touche à rien', async () => {
    poser(null);
    await Promise.resolve();
    expect(reglerNotificationPrestataires).not.toHaveBeenCalled();
  });

  it('pas encore connecté : rien n’est réglé', () => {
    poser({ role: 'client', pseudo: 'Puma', zone: 'Akanda' }, null);
    expect(reglerNotificationPrestataires).not.toHaveBeenCalled();
  });

  it('une seule fois, même si l’écran se redessine', async () => {
    const { rerender } = poser({ role: 'client', pseudo: 'Puma', zone: 'Akanda' });
    await waitFor(() => expect(reglerNotificationPrestataires).toHaveBeenCalledTimes(1));
    rerender(<ReglesNotifications />);
    expect(reglerNotificationPrestataires).toHaveBeenCalledTimes(1);
  });
});
