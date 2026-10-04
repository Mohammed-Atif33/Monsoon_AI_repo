"""Geographic helpers: distances, an approximate land mask and coastline distance.

The land mask and coastline are deliberately coarse. They are only used to
place simulated grid points and to derive a coastal-proximity feature; they are
NOT an authoritative boundary and are never drawn on the map.
"""
from __future__ import annotations

import numpy as np
from sklearn.neighbors import BallTree

EARTH_R = 6371.0

# --- coarse land polygons (lon, lat) used only to place simulated grid points
_MAIN = [
    (68.2, 23.6), (68.9, 22.4), (70.3, 20.8), (72.4, 21.2), (72.9, 19.0), (73.7, 15.4),
    (74.8, 12.9), (76.2, 9.9), (77.5, 8.1), (78.3, 8.8), (79.4, 10.3), (80.3, 13.1),
    (80.9, 15.8), (82.3, 16.9), (83.3, 17.7), (85.0, 19.3), (86.9, 21.4), (88.4, 21.7),
    (89.0, 22.6), (88.7, 24.2), (88.2, 25.2), (88.3, 26.4), (87.0, 26.4), (84.5, 27.2),
    (83.0, 27.4), (81.5, 28.5), (80.2, 29.0), (80.1, 30.2), (79.0, 31.0), (78.7, 32.5),
    (79.4, 33.5), (79.0, 34.7), (77.5, 35.4), (76.0, 35.4), (74.5, 34.6), (74.0, 33.4),
    (74.4, 32.4), (75.3, 32.3), (74.7, 31.1), (74.0, 30.6), (73.0, 29.9), (71.9, 27.9),
    (70.3, 27.3), (70.0, 26.0), (70.5, 25.0), (69.5, 24.3), (68.9, 23.9),
]
_NE = [
    (89.7, 26.0), (89.9, 26.7), (91.6, 26.8), (92.1, 27.3), (93.0, 28.3), (94.3, 29.3),
    (96.2, 29.2), (97.3, 28.3), (96.3, 27.3), (95.3, 26.1), (94.7, 25.0), (94.2, 23.8),
    (93.4, 23.0), (93.1, 22.0), (92.3, 22.3), (92.2, 23.6), (91.6, 24.1), (91.4, 24.9),
    (90.4, 25.1), (89.9, 25.3),
]
_NECK = [(88.0, 26.3), (89.9, 26.0), (89.9, 26.9), (88.1, 27.0)]
LAND_POLYGONS = [_MAIN, _NE, _NECK]

# coastline = the maritime part of the main polygon (Kutch -> Sundarbans)
_COAST_VERTS = _MAIN[:19]


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_R * np.arcsin(np.sqrt(a))


def _in_poly(lon, lat, poly) -> np.ndarray:
    """Vectorised even-odd ray casting."""
    lon = np.asarray(lon, float)
    lat = np.asarray(lat, float)
    inside = np.zeros(lon.shape, bool)
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = ((yi > lat) != (yj > lat)) & (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi)
        inside ^= cond
        j = i
    return inside


def in_india(lon, lat) -> np.ndarray:
    out = np.zeros(np.shape(lon), bool)
    for poly in LAND_POLYGONS:
        out |= _in_poly(lon, lat, poly)
    return out


def _densify(verts, step_km=8.0):
    pts = []
    for (x1, y1), (x2, y2) in zip(verts[:-1], verts[1:]):
        d = float(haversine_km(y1, x1, y2, x2))
        n = max(2, int(d / step_km))
        t = np.linspace(0, 1, n, endpoint=False)
        pts.extend(zip(y1 + (y2 - y1) * t, x1 + (x2 - x1) * t))
    pts.append((verts[-1][1], verts[-1][0]))
    return np.array(pts)


_COAST_PTS = _densify(_COAST_VERTS)
_COAST_TREE = BallTree(np.radians(_COAST_PTS), metric="haversine")


def coast_distance(lat, lon):
    """Return (distance_km, side) where side is +1 for east coast, -1 for west coast."""
    q = np.radians(np.column_stack([np.atleast_1d(lat), np.atleast_1d(lon)]))
    dist, idx = _COAST_TREE.query(q, k=1)
    nearest = _COAST_PTS[idx[:, 0]]
    side = np.where(nearest[:, 1] > 77.6, 1.0, -1.0)
    return dist[:, 0] * EARTH_R, side


def build_adjacency(lat, lon, radius_km: float) -> np.ndarray:
    """Boolean N x N matrix: True where points are within radius_km (self included)."""
    tree = BallTree(np.radians(np.column_stack([lat, lon])), metric="haversine")
    ind = tree.query_radius(np.radians(np.column_stack([lat, lon])), r=radius_km / EARTH_R)
    n = len(lat)
    adj = np.zeros((n, n), bool)
    for i, nb in enumerate(ind):
        adj[i, nb] = True
    return adj


def sig(x):
    return 1.0 / (1.0 + np.exp(-np.asarray(x, float)))


_NB_CACHE: dict = {}


def neighbour_lists(lat: np.ndarray, lon: np.ndarray, radius_km: float):
    """CSR-style neighbour lists (flat, starts, counts) within radius_km (self included). Cached."""
    key = (len(lat), float(np.sum(lat)), float(np.sum(lon)), float(lat[0]), float(lon[-1]), float(radius_km))
    hit = _NB_CACHE.get(key)
    if hit is not None:
        return hit
    pts = np.radians(np.column_stack([lat, lon]))
    tree = BallTree(pts, metric="haversine")
    nb = tree.query_radius(pts, r=radius_km / EARTH_R)
    counts = np.array([len(x) for x in nb])
    flat = np.concatenate(nb)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    if len(_NB_CACHE) > 24:
        _NB_CACHE.clear()
    _NB_CACHE[key] = (flat, starts, counts)
    return _NB_CACHE[key]
