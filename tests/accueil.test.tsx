import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Accueil } from '../src/ecrans/accueil/Accueil';

describe('Accueil', () => {
  it('affiche le nom SIA', () => {
    render(<Accueil />);
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
  });
});
