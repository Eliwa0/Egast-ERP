import API from './api';

export const shippingGet = async (path, params) => (await API.get(`shipping/${path}`, { params })).data;
export const shippingPost = async (path, data = {}) => (await API.post(`shipping/${path}`, data)).data;
export const saveShippingManifest = async (id, data) => (await API.put(`shipping/operations/${id}/`, data)).data;
