import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BoutonPrincipal } from '../src/ui/BoutonPrincipal';
import { BoutonSia } from '../src/ui/BoutonSia';
import { IndicateurMiseAJour } from '../src/ui/IndicateurMiseAJour';
import { ReponseOuiNon } from '../src/ui/ReponseOuiNon';

describe('ReponseOuiNon', () => {
  const proprietes = { question: "D'accord ?", envoi: false, erreur: null };

  it('pose sa question avec Non et Oui', () => {
    const surOui = vi.fn();
    const surNon = vi.fn();
    render(<ReponseOuiNon {...proprietes} onOui={surOui} onNon={surNon} />);
    expect(screen.getByText("D'accord ?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    expect(surOui).toHaveBeenCalledTimes(1);
    expect(surNon).toHaveBeenCalledTimes(1);
  });

  it('réponse partie : « Réponse envoyée… » à la place des boutons', () => {
    render(<ReponseOuiNon {...proprietes} envoi onOui={vi.fn()} onNon={vi.fn()} />);
    expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
    expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('le serveur a refusé : le message remplace la question, les boutons reviennent', () => {
    render(
      <ReponseOuiNon
        {...proprietes}
        erreur="Pas de réseau. Réessaie."
        onOui={vi.fn()}
        onNon={vi.fn()}
      />,
    );
    expect(screen.getByText('Pas de réseau. Réessaie.')).toBeInTheDocument();
    expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Oui' })).toBeEnabled();
  });

  it('le texte est annoncé au lecteur d’écran quand il change', () => {
    render(<ReponseOuiNon {...proprietes} onOui={vi.fn()} onNon={vi.fn()} />);
    expect(screen.getByText("D'accord ?")).toHaveAttribute('aria-live', 'polite');
  });

  it('prend la classe de mise en page de l’écran qui l’emploie', () => {
    const { container } = render(
      <ReponseOuiNon {...proprietes} className="bulles__choix" onOui={vi.fn()} onNon={vi.fn()} />,
    );
    expect(container.firstElementChild).toHaveClass('reponse', 'bulles__choix');
  });
});

describe('BoutonPrincipal « envoyé »', () => {
  it('par défaut : un bouton normal', () => {
    render(<BoutonPrincipal>Demander</BoutonPrincipal>);
    const bouton = screen.getByRole('button', { name: 'Demander' });
    expect(bouton).toBeEnabled();
    expect(bouton).not.toHaveAttribute('aria-busy');
  });

  it('envoyé : prend le texte d’envoi, ne réagit plus, garde la couleur', () => {
    const surClic = vi.fn();
    render(
      <BoutonPrincipal envoye="Demande envoyée…" onClick={surClic}>
        Demander
      </BoutonPrincipal>,
    );
    const bouton = screen.getByRole('button', { name: 'Demande envoyée…' });
    expect(bouton).toBeDisabled();
    expect(bouton).toHaveAttribute('aria-busy', 'true');
    expect(bouton).toHaveClass('bouton--principal', 'bouton--envoye');
    expect(screen.queryByText('Demander')).not.toBeInTheDocument();
    fireEvent.click(bouton);
    expect(surClic).not.toHaveBeenCalled();
  });

  it('le mode « chargement » d’avant marche toujours', () => {
    render(<BoutonPrincipal chargement>Entrer</BoutonPrincipal>);
    const bouton = screen.getByRole('button', { name: 'Entrer' });
    expect(bouton).toBeDisabled();
    expect(bouton).not.toHaveClass('bouton--envoye');
  });
});

describe('BoutonSia pendant que le serveur confirme', () => {
  it('allumé et en attente : reste vert et annoncé « occupé »', () => {
    render(<BoutonSia allume actif chargement onClick={vi.fn()} />);
    const bouton = screen.getByRole('button', { name: 'SIA' });
    expect(bouton).toHaveClass('bouton-sia--allume');
    expect(bouton).toHaveAttribute('aria-pressed', 'true');
    expect(bouton).toHaveAttribute('aria-busy', 'true');
    expect(bouton).toBeDisabled();
  });
});

describe('IndicateurMiseAJour', () => {
  it('la zone est toujours là, annoncée poliment ; le texte vient quand c’est actif', () => {
    const { rerender, container } = render(<IndicateurMiseAJour actif={false} />);
    const zone = container.firstElementChild;
    expect(zone).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText('Mise à jour…')).not.toBeInTheDocument();
    rerender(<IndicateurMiseAJour actif />);
    expect(screen.getByText('Mise à jour…')).toBeInTheDocument();
    expect(container.firstElementChild).toBe(zone);
  });
});
