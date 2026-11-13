"""Encrypted, bounded profile snapshots. Never expose profile objects to clients."""
import io
import tarfile
from pathlib import Path, PurePosixPath
from cryptography.fernet import Fernet

MAX_ARCHIVE = 35 * 1024 * 1024
MAX_EXPANDED = 200 * 1024 * 1024
SKIP = {'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache',
        'ShaderCache', 'Crashpad', 'BrowserMetrics', 'SingletonLock',
        'SingletonSocket', 'SingletonCookie'}

def pack_profile(folder: Path, key: str) -> bytes:
    buffer = io.BytesIO()
    total = 0
    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
        for path in sorted(folder.rglob('*')):
            relative = path.relative_to(folder)
            if path.is_symlink() or any(part in SKIP for part in relative.parts) or not path.is_file():
                continue
            total += path.stat().st_size
            if total > MAX_EXPANDED:
                raise ValueError('Profile is too large to back up on this configuration.')
            archive.add(path, arcname=relative.as_posix(), recursive=False)
    if buffer.tell() > MAX_ARCHIVE:
        raise ValueError('Profile backup exceeds the configured upload limit.')
    return Fernet(key.encode()).encrypt(buffer.getvalue())

def unpack_profile(payload: bytes, folder: Path, key: str):
    if len(payload) > 50 * 1024 * 1024:
        raise ValueError('Backup is too large.')
    decoded = Fernet(key.encode()).decrypt(payload)
    if len(decoded) > MAX_ARCHIVE:
        raise ValueError('Archive is too large.')
    with tarfile.open(fileobj=io.BytesIO(decoded), mode='r:gz') as archive:
        total = 0
        members = archive.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            total += member.size
            if (not member.isfile() or path.is_absolute() or '..' in path.parts
                    or '\\' in member.name or ':' in member.name
                    or total > MAX_EXPANDED or len(members) > 30000):
                raise ValueError('Invalid profile archive.')
        folder.mkdir(parents=True, exist_ok=True)
        for member in members:
            target = folder.joinpath(*PurePosixPath(member.name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source:
                target.write_bytes(source.read())
