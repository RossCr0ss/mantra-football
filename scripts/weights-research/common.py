"""Helpers shared by the fitting scripts. The blends mirror calcScore() in apps/web/src/lib/tourScoring.ts."""
import os, pickle
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')


def load_features():
    return pickle.load(open(os.path.join(DATA, 'feat.pkl'), 'rb'))


def pm(df, stat):
    """Per-appearance rate of a counting stat blended between this season and last season (calcScore's pm())."""
    mp = df['c_apps'].values.astype(float)
    pmp = df['p_apps'].values.astype(float)
    cur = df['c_' + stat].values.astype(float)
    pri = df['p_' + stat].values.astype(float)
    w = np.minimum(1.0, mp / 4.0)
    cur_rate = np.where(mp > 0, cur / np.where(mp > 0, mp, 1), np.nan)
    pri_rate = np.where(pmp > 0, pri / np.where(pmp > 0, pmp, 1), np.nan)
    return np.where(np.isnan(cur_rate), np.where(np.isnan(pri_rate), 0.0, pri_rate),
                    np.where(np.isnan(pri_rate), cur_rate, cur_rate * w + pri_rate * (1 - w)))


def season_rating(df):
    mp = df['c_apps'].values.astype(float)
    w = np.minimum(1.0, mp / 4.0)
    cur = np.where(df['c_rated'] > 0, df['c_rating_sum'] / df['c_rated'].replace(0, np.nan), np.nan)
    pri = np.where(df['p_rated'] > 0, df['p_rating_sum'] / df['p_rated'].replace(0, np.nan), np.nan)
    return np.where(np.isnan(cur), np.where(np.isnan(pri), 6.0, pri), np.where(np.isnan(pri), cur, cur * w + pri * (1 - w)))


def avg_minutes(df):
    mp = df['c_apps'].values.astype(float)
    pmp = df['p_apps'].values.astype(float)
    w = np.minimum(1.0, mp / 4.0)
    cur = np.where(mp > 0, df['c_min'] / np.where(mp > 0, mp, 1), np.nan)
    pri = np.where(pmp > 0, df['p_min'] / np.where(pmp > 0, pmp, 1), np.nan)
    return np.where(np.isnan(cur), pri, np.where(np.isnan(pri), cur, cur * w + pri * (1 - w)))
