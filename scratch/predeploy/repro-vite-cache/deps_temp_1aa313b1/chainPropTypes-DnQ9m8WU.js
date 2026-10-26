//#region frontend/node_modules/@mui/utils/chainPropTypes/chainPropTypes.mjs
function chainPropTypes(propType1, propType2) {
	return function validate(...args) {
		return propType1(...args) || propType2(...args);
	};
}
//#endregion
export { chainPropTypes as t };

//# sourceMappingURL=chainPropTypes-DnQ9m8WU.js.map