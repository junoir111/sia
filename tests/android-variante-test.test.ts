import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lire = (chemin: string) => readFileSync(chemin, 'utf-8');
const gradle = lire('android/app/build.gradle');
const activite = lire('android/app/src/main/java/io/github/junoir111/sia/MainActivity.java');
const workflow = lire('.github/workflows/sia-apk.yml');
const capacitor = JSON.parse(lire('capacitor.config.json')) as { android?: { webContentsDebuggingEnabled?: boolean } };

describe('variante TEST de l\'APK', () => {
  it('SIA_TEST vaut false sans -PsiaTest=true', () => {
    expect(gradle).toContain("project.hasProperty('siaTest') && project.property('siaTest') == 'true'");
    expect(gradle).toContain('buildConfigField "boolean", "SIA_TEST", siaTest.toString()');
  });

  it('FLAG_SECURE reste posé quand SIA_TEST est faux', () => {
    expect(activite).toMatch(/if \(!BuildConfig\.SIA_TEST\) \{\s*getWindow\(\)\.setFlags\(WindowManager\.LayoutParams\.FLAG_SECURE/);
  });

  it('le débogage du WebView est coupé, sauf variante TEST, et imposé APRÈS le démarrage de Capacitor', () => {
    expect(capacitor.android?.webContentsDebuggingEnabled).toBe(false);
    expect(activite).not.toContain('setWebContentsDebuggingEnabled(true)');
    const apres = activite.indexOf('super.onCreate(savedInstanceState);');
    const reglage = activite.indexOf('WebView.setWebContentsDebuggingEnabled(BuildConfig.SIA_TEST);');
    expect(apres).toBeGreaterThan(-1);
    expect(reglage).toBeGreaterThan(apres);
  });

  it('la version essai est une version finale (release), non débogable', () => {
    expect(workflow).toContain('assembleRelease');
    expect(workflow.match(/assembleDebug/g)).toHaveLength(1);
  });

  it('l\'identifiant d\'appli ne change pas', () => {
    expect(gradle).toContain('applicationId "io.github.junoir111.sia"');
  });

  it('seule une étiquette test-* passe -PsiaTest=true', () => {
    expect(workflow.match(/-PsiaTest=true/g)).toHaveLength(1);
    expect(workflow).toContain('"$ETIQUETTE" == test-*');
  });
});
