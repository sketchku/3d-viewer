"""Convert proprietary CAD files to STEP via installed CAD apps or FreeCAD."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

APP_KEYS = {
    'sldprt': 'solidworks', 'sldasm': 'solidworks', 'slddrw': 'solidworks',
    'ipt': 'inventor', 'iam': 'inventor', 'ipn': 'inventor',
    'f3d': 'fusion360', 'f3z': 'fusion360',
    'prt': 'creo', 'asm': 'creo', 'drw': 'creo',
    'catpart': 'catia', 'catproduct': 'catia', 'catdrawing': 'catia',
    'cgr': 'catia', 'model': 'catia',
}

DOC_TYPES = {
    'sldprt': 1, 'sldasm': 2, 'slddrw': 3,
    'ipt': 'part', 'iam': 'assembly',
    'catpart': 'part', 'catproduct': 'product', 'catdrawing': 'drawing',
}


class ConversionError(Exception):
    pass


def get_app_key(ext: str) -> str | None:
    return APP_KEYS.get((ext or '').lower())


def _run_powershell(script: str, timeout: int = 300) -> None:
    proc = subprocess.run(
        [
            'powershell',
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            script,
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding='utf-8',
        errors='replace',
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or '').strip()
        raise ConversionError(detail or f'PowerShell exit {proc.returncode}')


def _com_available(prog_id: str) -> bool:
    script = textwrap.dedent(f"""
    try {{
      $x = New-Object -ComObject {prog_id}
      $x | Out-Null
      exit 0
    }} catch {{
      exit 1
    }}
    """)
    try:
        proc = subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
            capture_output=True,
            timeout=20,
        )
        return proc.returncode == 0
    except Exception:
        return False


def _find_freecad_cmd() -> str | None:
    candidates = [
        shutil.which('FreeCADCmd'),
        shutil.which('freecadcmd'),
    ]
    for env_key in ('FREECAD_CMD', 'FREECAD_BIN'):
        val = os.environ.get(env_key)
        if val:
            candidates.append(val)
    for base in (
        os.path.expandvars(r'%ProgramFiles%\FreeCAD 1.0\bin\FreeCADCmd.exe'),
        os.path.expandvars(r'%ProgramFiles%\FreeCAD 0.21\bin\FreeCADCmd.exe'),
        os.path.expandvars(r'%ProgramFiles%\FreeCAD 0.20\bin\FreeCADCmd.exe'),
        os.path.expandvars(r'%ProgramFiles(x86)%\FreeCAD 0.21\bin\FreeCADCmd.exe'),
    ):
        candidates.append(base)
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def detect_backends() -> list[str]:
    found: list[str] = []
    if _com_available('SldWorks.Application'):
        found.append('solidworks')
    if _com_available('Inventor.Application'):
        found.append('inventor')
    if _com_available('CATIA.Application'):
        found.append('catia')
    if _find_freecad_cmd():
        found.append('freecad')
    return found


def get_convert_backends_for_ext(ext: str, installed: list[str] | None = None) -> list[str]:
    """Return backends that can convert this extension (mirrors convert_to_step attempts)."""
    app_key = get_app_key(ext)
    if not app_key:
        return []

    available = set(installed or detect_backends())
    result: list[str] = []

    if app_key == 'solidworks' and 'solidworks' in available:
        result.append('solidworks')
    elif app_key == 'inventor' and 'inventor' in available:
        result.append('inventor')
    elif app_key == 'catia' and 'catia' in available:
        result.append('catia')

    if 'freecad' in available:
        result.append('freecad')

    return result


def can_convert_ext(ext: str, installed: list[str] | None = None) -> bool:
    return len(get_convert_backends_for_ext(ext, installed)) > 0


def _convert_solidworks(input_path: str, output_path: str, ext: str) -> None:
    doc_type = DOC_TYPES.get(ext, 1)
    in_esc = input_path.replace("'", "''")
    out_esc = output_path.replace("'", "''")
    script = textwrap.dedent(f"""
    $ErrorActionPreference = 'Stop'
    $sw = New-Object -ComObject SldWorks.Application
    $sw.Visible = $false
    $errors = 0
    $warnings = 0
    $doc = $sw.OpenDoc6('{in_esc}', {doc_type}, 0, '', [ref]$errors, [ref]$warnings)
    if ($null -eq $doc) {{ throw "SolidWorks open failed (errors=$errors)" }}
    $ok = $doc.SaveAs3('{out_esc}', 0, 0)
    if (-not $ok) {{ throw 'SolidWorks SaveAs3 failed' }}
    $sw.CloseDoc('{in_esc}')
    $sw.ExitApp()
    """)
    _run_powershell(script)


def _convert_inventor(input_path: str, output_path: str) -> None:
    in_esc = input_path.replace("'", "''")
    out_esc = output_path.replace("'", "''")
    script = textwrap.dedent(f"""
    $ErrorActionPreference = 'Stop'
    $inv = New-Object -ComObject Inventor.Application
    $inv.Visible = $false
    $doc = $inv.Documents.Open('{in_esc}', $true)
    if ($null -eq $doc) {{ throw 'Inventor open failed' }}
    $doc.SaveAs('{out_esc}', $true)
    $doc.Close($true)
    $inv.Quit()
    """)
    _run_powershell(script)


def _convert_catia(input_path: str, output_path: str) -> None:
    in_esc = input_path.replace("'", "''")
    out_esc = output_path.replace("'", "''")
    script = textwrap.dedent(f"""
    $ErrorActionPreference = 'Stop'
    $catia = New-Object -ComObject CATIA.Application
    $doc = $catia.Documents.Open('{in_esc}')
    if ($null -eq $doc) {{ throw 'CATIA open failed' }}
    try {{
      $doc.ExportData('{out_esc}', 'stp')
    }} catch {{
      $doc.SaveAs('{out_esc}')
    }}
    $doc.Close()
    """)
    _run_powershell(script)


def _convert_freecad(input_path: str, output_path: str) -> None:
    cmd = _find_freecad_cmd()
    if not cmd:
        raise ConversionError('FreeCAD not found')
    py_script = textwrap.dedent(f"""
    import sys
    import Part
    import FreeCAD as App
    src = sys.argv[1]
    dst = sys.argv[2]
    doc = App.openDocument(src)
    objs = [o for o in doc.Objects if hasattr(o, 'Shape') and not o.Shape.isNull()]
    if not objs:
        raise RuntimeError('No exportable shapes in FreeCAD')
    Part.export(objs, dst)
    doc.close()
    """)
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False, encoding='utf-8') as handle:
        handle.write(py_script)
        script_path = handle.name
    try:
        proc = subprocess.run(
            [cmd, script_path, input_path, output_path],
            capture_output=True,
            text=True,
            timeout=300,
            encoding='utf-8',
            errors='replace',
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or '').strip()
            raise ConversionError(detail or f'FreeCAD exit {proc.returncode}')
    finally:
        try:
            os.remove(script_path)
        except OSError:
            pass


def convert_to_step(input_path: str, ext: str, output_path: str | None = None) -> str:
    ext = (ext or Path(input_path).suffix.lstrip('.')).lower()
    app_key = get_app_key(ext)
    if not app_key:
        raise ConversionError(f'Unsupported extension: {ext}')

    if not os.path.isfile(input_path):
        raise ConversionError('Input file not found')

    out_path = output_path or os.path.join(
        tempfile.gettempdir(),
        f'viewer-convert-{os.getpid()}-{Path(input_path).stem}.stp',
    )
    if os.path.isfile(out_path):
        os.remove(out_path)

    errors: list[str] = []
    attempts: list[tuple[str, callable]] = []

    if app_key == 'solidworks':
        attempts.append(('solidworks', lambda: _convert_solidworks(input_path, out_path, ext)))
    elif app_key == 'inventor':
        attempts.append(('inventor', lambda: _convert_inventor(input_path, out_path)))
    elif app_key == 'catia':
        attempts.append(('catia', lambda: _convert_catia(input_path, out_path)))
    elif app_key in ('creo', 'fusion360'):
        pass

    if _find_freecad_cmd():
        attempts.append(('freecad', lambda: _convert_freecad(input_path, out_path)))

    if not attempts:
        raise ConversionError(
            'No converter available. Install SolidWorks, Inventor, CATIA, or FreeCAD, '
            'or export STEP manually from your CAD software.'
        )

    for name, fn in attempts:
        try:
            fn()
            if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                return out_path
            errors.append(f'{name}: output file missing')
        except Exception as exc:
            errors.append(f'{name}: {exc}')
            if os.path.isfile(out_path):
                try:
                    os.remove(out_path)
                except OSError:
                    pass

    raise ConversionError('; '.join(errors) or 'Conversion failed')