"""Location catalogue: real district anchors + a land-masked grid, with static geography.

Anchors carry approximate district-HQ coordinates/elevations. Grid cells fill the
remaining land at ~0.7 degree spacing and inherit the state of the nearest anchor.
Static geographic descriptors (coast proximity, orographic zone, rain-shadow ...)
are derived here once and reused by the simulation engine and feature pipeline.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from ..utils.geo import EARTH_R, build_adjacency, coast_distance, in_india, sig

# district, state, lat, lon, elevation (m)
ANCHORS = [
    # Maharashtra
    ("Mumbai", "Maharashtra", 19.08, 72.88, 14), ("Thane", "Maharashtra", 19.20, 72.97, 10),
    ("Raigad", "Maharashtra", 18.64, 72.87, 5), ("Ratnagiri", "Maharashtra", 16.99, 73.30, 10),
    ("Sindhudurg", "Maharashtra", 16.35, 73.75, 20), ("Pune", "Maharashtra", 18.52, 73.86, 560),
    ("Nashik", "Maharashtra", 20.00, 73.79, 565), ("Kolhapur", "Maharashtra", 16.70, 74.24, 550),
    ("Satara", "Maharashtra", 17.69, 74.00, 700), ("Nagpur", "Maharashtra", 21.15, 79.09, 310),
    ("Aurangabad", "Maharashtra", 19.88, 75.34, 580), ("Solapur", "Maharashtra", 17.66, 75.91, 460),
    ("Amravati", "Maharashtra", 20.93, 77.75, 340), ("Chandrapur", "Maharashtra", 19.96, 79.30, 190),
    ("Nanded", "Maharashtra", 19.15, 77.32, 360),
    # Goa / Karnataka
    ("North Goa", "Goa", 15.49, 73.83, 10), ("Bengaluru", "Karnataka", 12.97, 77.59, 920),
    ("Dakshina Kannada", "Karnataka", 12.91, 74.86, 20), ("Udupi", "Karnataka", 13.34, 74.75, 5),
    ("Uttara Kannada", "Karnataka", 14.81, 74.13, 10), ("Kodagu", "Karnataka", 12.42, 75.74, 1150),
    ("Chikkamagaluru", "Karnataka", 13.32, 75.77, 1090), ("Belagavi", "Karnataka", 15.85, 74.50, 750),
    ("Kalaburagi", "Karnataka", 17.33, 76.83, 450), ("Mysuru", "Karnataka", 12.30, 76.64, 770),
    ("Shivamogga", "Karnataka", 13.93, 75.57, 570),
    # Kerala
    ("Thiruvananthapuram", "Kerala", 8.52, 76.94, 10), ("Ernakulam", "Kerala", 9.93, 76.27, 5),
    ("Kozhikode", "Kerala", 11.26, 75.78, 5), ("Idukki", "Kerala", 9.85, 76.97, 1000),
    ("Wayanad", "Kerala", 11.69, 76.13, 900), ("Alappuzha", "Kerala", 9.49, 76.33, 2),
    ("Kannur", "Kerala", 11.87, 75.37, 5), ("Palakkad", "Kerala", 10.78, 76.65, 85),
    # Tamil Nadu / Puducherry
    ("Chennai", "Tamil Nadu", 13.08, 80.27, 6), ("Coimbatore", "Tamil Nadu", 11.02, 76.96, 410),
    ("Madurai", "Tamil Nadu", 9.92, 78.12, 130), ("Tirunelveli", "Tamil Nadu", 8.73, 77.70, 45),
    ("The Nilgiris", "Tamil Nadu", 11.41, 76.70, 2240), ("Thanjavur", "Tamil Nadu", 10.79, 79.14, 60),
    ("Kanyakumari", "Tamil Nadu", 8.09, 77.54, 5), ("Salem", "Tamil Nadu", 11.66, 78.15, 280),
    ("Puducherry", "Puducherry", 11.93, 79.83, 10),
    # Andhra / Telangana
    ("Visakhapatnam", "Andhra Pradesh", 17.69, 83.22, 5), ("Krishna", "Andhra Pradesh", 16.51, 80.65, 20),
    ("Guntur", "Andhra Pradesh", 16.31, 80.44, 30), ("Tirupati", "Andhra Pradesh", 13.63, 79.42, 160),
    ("Kurnool", "Andhra Pradesh", 15.83, 78.04, 280), ("Nellore", "Andhra Pradesh", 14.44, 79.99, 20),
    ("East Godavari", "Andhra Pradesh", 16.99, 82.24, 5), ("Hyderabad", "Telangana", 17.39, 78.49, 540),
    ("Warangal", "Telangana", 17.97, 79.60, 270), ("Adilabad", "Telangana", 19.66, 78.53, 260),
    # Odisha
    ("Khordha", "Odisha", 20.30, 85.82, 45), ("Puri", "Odisha", 19.81, 85.83, 5),
    ("Balasore", "Odisha", 21.49, 86.93, 20), ("Koraput", "Odisha", 18.81, 82.71, 870),
    ("Sambalpur", "Odisha", 21.47, 83.97, 140), ("Ganjam", "Odisha", 19.31, 84.79, 30),
    ("Keonjhar", "Odisha", 21.63, 85.58, 480),
    # West Bengal
    ("Kolkata", "West Bengal", 22.57, 88.36, 9), ("South 24 Parganas", "West Bengal", 22.19, 88.19, 5),
    ("Darjeeling", "West Bengal", 27.04, 88.26, 2050), ("Jalpaiguri", "West Bengal", 26.52, 88.73, 85),
    ("Purulia", "West Bengal", 23.33, 86.36, 220), ("Murshidabad", "West Bengal", 24.10, 88.25, 20),
    # Jharkhand / Bihar
    ("Ranchi", "Jharkhand", 23.34, 85.31, 650), ("Bokaro", "Jharkhand", 23.67, 86.15, 210),
    ("Patna", "Bihar", 25.59, 85.14, 55), ("Gaya", "Bihar", 24.80, 85.00, 110),
    ("Darbhanga", "Bihar", 26.16, 85.90, 50), ("Purnia", "Bihar", 25.78, 87.47, 35),
    # Chhattisgarh / MP
    ("Raipur", "Chhattisgarh", 21.25, 81.63, 300), ("Bastar", "Chhattisgarh", 19.07, 82.03, 570),
    ("Bilaspur", "Chhattisgarh", 22.08, 82.14, 260), ("Surguja", "Chhattisgarh", 23.12, 83.20, 620),
    ("Bhopal", "Madhya Pradesh", 23.26, 77.41, 520), ("Indore", "Madhya Pradesh", 22.72, 75.86, 550),
    ("Jabalpur", "Madhya Pradesh", 23.18, 79.94, 410), ("Gwalior", "Madhya Pradesh", 26.22, 78.18, 200),
    ("Rewa", "Madhya Pradesh", 24.53, 81.30, 320), ("Ujjain", "Madhya Pradesh", 23.18, 75.78, 490),
    # Gujarat
    ("Ahmedabad", "Gujarat", 23.02, 72.57, 50), ("Surat", "Gujarat", 21.17, 72.83, 13),
    ("Vadodara", "Gujarat", 22.31, 73.18, 35), ("Rajkot", "Gujarat", 22.30, 70.80, 130),
    ("Kutch", "Gujarat", 23.25, 69.67, 100), ("Junagadh", "Gujarat", 21.52, 70.46, 110),
    ("Bhavnagar", "Gujarat", 21.76, 72.15, 20), ("Porbandar", "Gujarat", 21.64, 69.61, 5),
    ("Valsad", "Gujarat", 20.60, 72.93, 10),
    # Rajasthan
    ("Jaipur", "Rajasthan", 26.91, 75.79, 430), ("Jodhpur", "Rajasthan", 26.24, 73.02, 230),
    ("Jaisalmer", "Rajasthan", 26.92, 70.92, 225), ("Bikaner", "Rajasthan", 28.02, 73.31, 230),
    ("Udaipur", "Rajasthan", 24.59, 73.71, 600), ("Kota", "Rajasthan", 25.18, 75.83, 270),
    ("Ajmer", "Rajasthan", 26.45, 74.64, 480), ("Sri Ganganagar", "Rajasthan", 29.92, 73.88, 175),
    ("Barmer", "Rajasthan", 25.75, 71.42, 140), ("Sirohi", "Rajasthan", 24.59, 72.71, 1220),
    # Uttar Pradesh
    ("Lucknow", "Uttar Pradesh", 26.85, 80.95, 120), ("Varanasi", "Uttar Pradesh", 25.32, 83.01, 80),
    ("Prayagraj", "Uttar Pradesh", 25.44, 81.85, 98), ("Agra", "Uttar Pradesh", 27.18, 78.01, 170),
    ("Gorakhpur", "Uttar Pradesh", 26.76, 83.37, 84), ("Kanpur", "Uttar Pradesh", 26.45, 80.35, 125),
    ("Meerut", "Uttar Pradesh", 28.98, 77.71, 220), ("Jhansi", "Uttar Pradesh", 25.45, 78.57, 285),
    ("Bareilly", "Uttar Pradesh", 28.35, 79.42, 170),
    # Uttarakhand / HP
    ("Dehradun", "Uttarakhand", 30.32, 78.03, 640), ("Nainital", "Uttarakhand", 29.39, 79.46, 2000),
    ("Chamoli", "Uttarakhand", 30.41, 79.32, 1500), ("Pithoragarh", "Uttarakhand", 29.58, 80.22, 1500),
    ("Haridwar", "Uttarakhand", 29.95, 78.16, 250), ("Shimla", "Himachal Pradesh", 31.10, 77.17, 2200),
    ("Kangra", "Himachal Pradesh", 32.22, 76.32, 1450), ("Kullu", "Himachal Pradesh", 31.96, 77.11, 1220),
    ("Chamba", "Himachal Pradesh", 32.55, 76.13, 1000), ("Lahaul & Spiti", "Himachal Pradesh", 32.22, 78.07, 3800),
    # Punjab / Haryana / Delhi / Chandigarh
    ("Amritsar", "Punjab", 31.63, 74.87, 234), ("Ludhiana", "Punjab", 30.90, 75.86, 244),
    ("Patiala", "Punjab", 30.34, 76.39, 250), ("Bathinda", "Punjab", 30.21, 74.95, 210),
    ("Gurugram", "Haryana", 28.46, 77.03, 220), ("Ambala", "Haryana", 30.38, 76.78, 270),
    ("Hisar", "Haryana", 29.15, 75.72, 220), ("Karnal", "Haryana", 29.69, 76.99, 230),
    ("New Delhi", "Delhi", 28.61, 77.21, 216), ("Chandigarh", "Chandigarh", 30.73, 76.78, 350),
    # J&K / Ladakh
    ("Srinagar", "Jammu & Kashmir", 34.08, 74.80, 1585), ("Jammu", "Jammu & Kashmir", 32.73, 74.86, 330),
    ("Anantnag", "Jammu & Kashmir", 33.73, 75.15, 1600), ("Kathua", "Jammu & Kashmir", 32.37, 75.52, 350),
    ("Leh", "Ladakh", 34.16, 77.58, 3500),
    # North-east
    ("Kamrup", "Assam", 26.14, 91.74, 55), ("Dibrugarh", "Assam", 27.48, 94.91, 105),
    ("Cachar", "Assam", 24.83, 92.78, 30), ("Jorhat", "Assam", 26.75, 94.20, 85),
    ("Sonitpur", "Assam", 26.63, 92.80, 50), ("Lakhimpur", "Assam", 27.24, 94.10, 100),
    ("East Khasi Hills", "Meghalaya", 25.30, 91.70, 1300), ("Imphal West", "Manipur", 24.82, 93.94, 790),
    ("Aizawl", "Mizoram", 23.73, 92.72, 1130), ("Kohima", "Nagaland", 25.67, 94.11, 1440),
    ("West Tripura", "Tripura", 23.83, 91.28, 12), ("Papum Pare", "Arunachal Pradesh", 27.10, 93.62, 440),
    ("Tawang", "Arunachal Pradesh", 27.59, 91.86, 2700), ("West Kameng", "Arunachal Pradesh", 27.26, 92.42, 2400),
    ("Upper Siang", "Arunachal Pradesh", 28.60, 95.00, 500), ("Lohit", "Arunachal Pradesh", 27.93, 96.16, 200),
    ("Changlang", "Arunachal Pradesh", 27.13, 95.74, 250), ("Dibang Valley", "Arunachal Pradesh", 28.80, 95.90, 1200), ("Gangtok", "Sikkim", 27.33, 88.61, 1650),
    # Islands
    ("South Andaman", "Andaman & Nicobar", 11.62, 92.73, 16), ("Lakshadweep", "Lakshadweep", 10.57, 72.64, 2),
]

GRID_SPACING = 0.62
_ISLAND_STATES = {"Andaman & Nicobar", "Lakshadweep"}


def _slug(text: str) -> str:
    return "".join(c.lower() if c.isalnum() else "-" for c in text).strip("-").replace("--", "-")


# ---------------------------------------------------------------- terrain / geography models
def _gauss(x, s):
    return np.exp(-(np.asarray(x, float) / s) ** 2)


_GHATS_LAT = np.array([8.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0, 22.0])
_GHATS_LON = np.array([77.3, 77.2, 76.6, 75.6, 74.2, 73.8, 73.4, 73.5, 73.7])
_HIMAL_LON = np.array([70.0, 76.0, 80.0, 85.0, 90.0, 92.0, 97.0, 99.0])
_HIMAL_BELT = np.array([32.0, 29.5, 28.5, 26.9, 26.6, 26.4, 26.6, 26.8])
_HIMAL_CREST = np.array([35.5, 34.0, 31.0, 28.6, 27.9, 28.3, 28.9, 29.2])


def ghats_ridge_lon(lat):
    return np.interp(lat, _GHATS_LAT, _GHATS_LON)


def elevation_model(lat, lon):
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    e = 120 + 45 * np.sin(lat * 1.3) * np.cos(lon * 0.9) + 40
    plateau = sig((lat - 11.5) / 0.7) * sig((21.5 - lat) / 0.7) * sig((lon - 74.8) / 0.7) * sig((79.8 - lon) / 0.9)
    e += 380 * plateau
    highlands = sig((lat - 21.6) / 0.5) * sig((24.6 - lat) / 0.5) * sig((lon - 74.0) / 0.8) * sig((87.0 - lon) / 0.8)
    e += 230 * highlands
    gh = sig((22 - lat) / 0.4) * sig((lat - 7.8) / 0.4)
    e += 850 * gh * _gauss(lon - (ghats_ridge_lon(lat) - 0.1), 0.45)
    e += 380 * _gauss(lat - (17.5 + (lon - 82) * 0.7), 1.4) * _gauss(lon - 82.0, 2.2)  # Eastern Ghats
    crest = np.interp(lon, _HIMAL_LON, _HIMAL_CREST)
    himal = sig((lat - (crest - 2.2)) / 0.9) * sig((lon - 72) / 1.0) * sig((98.5 - lon) / 1.0)
    e += 4300 * himal * (1 - 0.35 * sig((crest - 4 - lat) / -0.5))
    e += 1000 * _gauss(lon - 92.5, 1.6) * _gauss(lat - 25.2, 1.4)  # Meghalaya-Mizoram hills
    e += 300 * _gauss(lon - 73.6, 1.0) * _gauss(lat - 24.6, 1.6)  # Aravalli
    return np.clip(e, 2, 6000)


def _hill_zone(lat, lon, elev):
    """Returns (zone flag 0..1, onshore/upslope wind direction) for orographic potential."""
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    wg = sig((22 - lat) / 0.3) * sig((lat - 7.5) / 0.3) * sig((ghats_ridge_lon(lat) + 1.6 - lon) / 0.3) * sig((lon - (ghats_ridge_lon(lat) - 1.2)) / 0.3)
    him = sig((lat - np.interp(lon, _HIMAL_LON, _HIMAL_BELT)) / 0.4) * sig((lon - 74.5) / 0.6) * sig((98.5 - lon) / 0.6)
    ne = sig((lon - 89.5) / 0.4) * sig((96.5 - lon) / 0.4) * sig((lat - 22.3) / 0.3) * sig((27.0 - lat) / 0.3)
    eg = sig((lon - 79.0) / 0.4) * sig((84.5 - lon) / 0.4) * sig((lat - 14.0) / 0.4) * sig((20.5 - lat) / 0.4) * (elev > 350)
    zone = np.clip(np.maximum.reduce([wg, him, ne, 0.6 * eg]), 0, 1)
    wdir = np.select([wg >= np.maximum(him, ne) - 1e-9, him >= ne, ne > 0.5], [255.0, 178.0, 180.0], default=200.0)
    wdir = np.where(zone > 0.15, wdir, 250.0)
    return zone, wdir


@lru_cache(maxsize=1)
def get_catalog() -> pd.DataFrame:
    a = pd.DataFrame(ANCHORS, columns=["district", "state", "latitude", "longitude", "elevation"])
    a["is_district"] = True
    a["near"] = a["district"]

    # grid fill
    lats = np.arange(7.5, 35.6, GRID_SPACING)
    lons = np.arange(68.5, 97.6, GRID_SPACING)
    glat, glon = np.meshgrid(lats, lons, indexing="ij")
    glat, glon = glat.ravel(), glon.ravel()
    mask = in_india(glon, glat)
    glat, glon = glat[mask], glon[mask]
    tree = BallTree(np.radians(a[["latitude", "longitude"]].values), metric="haversine")
    d, idx = tree.query(np.radians(np.column_stack([glat, glon])), k=1)
    keep = (d[:, 0] * EARTH_R) > 55  # skip cells that sit on top of an anchor
    glat, glon, idx = glat[keep], glon[keep], idx[keep, 0]
    g = pd.DataFrame({
        "district": [f"Grid {la:.1f}N {lo:.1f}E (near {nr})" for la, lo, nr in zip(glat, glon, a["district"].values[idx])],
        "state": a["state"].values[idx],
        "latitude": glat, "longitude": glon,
        "elevation": np.round(elevation_model(glat, glon)),
        "is_district": False,
        "near": a["district"].values[idx],
    })
    cat = pd.concat([a, g], ignore_index=True)
    cat["id"] = [_slug(n) for n in cat["district"]]
    cat = cat.drop_duplicates("id").reset_index(drop=True)

    lat, lon, elev = cat["latitude"].values, cat["longitude"].values, cat["elevation"].values.astype(float)
    cd, side = coast_distance(lat, lon)
    island = cat["state"].isin(_ISLAND_STATES).values
    cd = np.where(island, 3.0, cd)
    cat["coast_dist_km"] = np.round(cd, 1)
    cat["coast_side"] = np.where(island, np.where(lon > 80, 1.0, -1.0), side)
    zone, wdir = _hill_zone(lat, lon, elev)
    cat["orog_idx"] = np.round(zone * np.clip((elev - 200) / 700, 0, 1), 4)
    cat["oro_wide"] = np.round(zone * np.clip((elev - 100) / 300, 0, 1), 4)
    cat["orog_wind_dir"] = wdir
    cat["coast_idx"] = np.round(np.exp(-cd / 90.0), 4)
    cat["coast_wide"] = np.round(np.exp(-cd / 300.0), 4)
    cat["north_idx"] = np.round(sig((lat - 27) / 1.2) * sig((84 - lon) / 2.5), 4)
    cat["nw_dry_idx"] = np.round(sig((lat - 22.5) / 1.2) * sig((76.5 - lon) / 1.5), 4)
    cat["ne_idx"] = np.round(sig((lon - 88.5) / 1.0) * sig((lat - 22) / 1.0), 4)
    cat["wd_wide"] = np.round(sig((lat - 21.5) / 1.2) * sig((85 - lon) / 3.0), 4)
    d_ridge = lon - ghats_ridge_lon(lat)
    lee = sig((d_ridge - 0.5) / 0.4) * sig((1.7 - d_ridge) / 0.4) * sig((lat - 11.5) / 0.5) * sig((20.5 - lat) / 0.5)
    cat["lee_idx"] = np.round(lee, 4)
    cat.insert(0, "loc_idx", np.arange(len(cat)))
    return cat


@lru_cache(maxsize=4)
def coverage_adjacency(radius_km: float = 250.0) -> np.ndarray:
    cat = get_catalog()
    return build_adjacency(cat["latitude"].values, cat["longitude"].values, radius_km)
