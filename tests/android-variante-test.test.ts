import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lire = (chemin: string) => readFileSync(chemin, 'utf-8');
const gradle = lire('android/app/build.gradle');
const activite = lire('android/app/src/main/java/io/github/junoir111/sia/MainActivity.java');
const workflow = lire('.github/workflows/sia-apk.yml');

describe('variante TEST de l\'APK', () => {
  it('SIA_TEST vaut false sans -PsiaTest=true', () => {
    expect(gradle).toContain("project.hasProperty('siaTest') && project.property('siaTest') == 'true'");
    expect(gradle).toContain('buildConfigField "boolean", "SIA_TEST", siaTest.toString()');
  });

  it('FLAG_SECURE reste posé quand SIA_TEST est faux', () => {
    expect(activite).toMatch(/if \(BuildConfig\.SIA_TEST\) \{\s*WebView\.setWebContentsDebuggingEnabled\(true\);\s*\} else \{\s*getWindow\(\)\.setFlags\(WindowManager\.LayoutParams\.FLAG_SECURE/);
  });

  it('l\'identifiant d\'appli ne change pas', () => {
    expect(gradle).toContain('applicationId "io.github.junoir111.sia"');
  });

  it('seule une étiquette test-* passe -PsiaTest=true', () => {
    expect(workflow.match(/-PsiaTest=true/g)).toHaveLength(1);
    expect(workflow).toContain('"$ETIQUETTE" == test-*');
  });
});
