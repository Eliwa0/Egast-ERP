import { r as __toESM } from "./chunk-BoAXSpZd.js";
import { t as require_react } from "./react.js";
import { t as require_jsx_runtime } from "./react_jsx-runtime.js";
import { H as useRtl, Mt as clsx, Nt as require_prop_types, Ot as deepmerge, U as exactProp, V as useId, c as useDefaultProps, ct as generateUtilityClass, d as styled, f as rootShouldForwardProp, h as useTheme, i as getTransitionStyles, jt as composeClasses, kt as require_react_is, l as memoTheme, n as getTransitionChildStyle, nt as useEnhancedEffect, o as normalizedTransitionCallback, p as slotShouldForwardProp, r as getTransitionProps, s as reflow, st as generateUtilityClasses, u as globalCss } from "./utils-B_lYHpnS.js";
import { t as capitalize_default } from "./capitalize-B03SSZaT.js";
import { A as createChainedFunction, B as activeElement, C as setRef, E as isMuiElement_default, F as filledInputClasses, G as ownerDocument, H as useEnhancedEffect_default, I as getFilledInputUtilityClass, J as debounce, K as useEventCallback, L as getInputBaseUtilityClass, M as outlinedInputClasses, N as getInputUtilityClass, O as debounce_default, P as inputClasses, R as inputBaseClasses, T as ownerWindow_default, U as useForkRef_default, V as ownerDocument_default, W as ownerWindow, X as refType, Y as isHostComponent, Z as elementTypeAcceptingRef_default, _ as useEventCallback_default, a as useSlotProps, d as useSlot, f as extractEventHandlers, g as mergeSlotProps, i as isLayoutSupported, j as getOutlinedInputUtilityClass, l as useTimeout, m as useLazyRef, n as Portal, o as HTMLElementType, p as useReducedMotion, q as useForkRef, r as getReactElementRef, s as contains, t as ArrowDropDown_default, v as useControlled_default, z as getActiveElement_default } from "./ArrowDropDown-UgHIvKny.js";
import { t as chainPropTypes } from "./chainPropTypes-DnQ9m8WU.js";
import { i as integerPropType, t as Paper } from "./Paper-Bjw-HKmq.js";
import { t as createSimplePaletteValueFilter } from "./createSimplePaletteValueFilter-Dr-ahFo_.js";
//#region frontend/node_modules/@mui/material/TextareaAutosize/TextareaAutosize.mjs
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var import_prop_types = /* @__PURE__ */ __toESM(require_prop_types(), 1);
var import_jsx_runtime = require_jsx_runtime();
function getStyleValue(value) {
	return parseInt(value, 10) || 0;
}
var styles$2 = { shadow: {
	visibility: "hidden",
	position: "absolute",
	overflow: "hidden",
	height: 0,
	top: 0,
	left: 0,
	transform: "translateZ(0)"
} };
function isObjectEmpty(object) {
	for (const _ in object) return false;
	return true;
}
function isEmpty$1(obj) {
	return isObjectEmpty(obj) || obj.outerHeightStyle === 0 && !obj.overflowing;
}
/**
*
* Demos:
*
* - [Textarea Autosize](https://mui.com/material-ui/react-textarea-autosize/)
*
* API:
*
* - [TextareaAutosize API](https://mui.com/material-ui/api/textarea-autosize/)
*/
var TextareaAutosize = /* @__PURE__ */ import_react.forwardRef(function TextareaAutosize(props, forwardedRef) {
	const { onChange, maxRows, minRows = 1, style, value, ...other } = props;
	const { current: isControlled } = import_react.useRef(value != null);
	const textareaRef = import_react.useRef(null);
	const handleRef = useForkRef(forwardedRef, textareaRef);
	const heightRef = import_react.useRef(null);
	const hiddenTextareaRef = import_react.useRef(null);
	const calculateTextareaStyles = import_react.useCallback(() => {
		const textarea = textareaRef.current;
		const hiddenTextarea = hiddenTextareaRef.current;
		if (!textarea || !hiddenTextarea) return;
		const computedStyle = ownerWindow(textarea).getComputedStyle(textarea);
		if (computedStyle.width === "0px") return {
			outerHeightStyle: 0,
			overflowing: false
		};
		hiddenTextarea.style.width = computedStyle.width;
		hiddenTextarea.value = textarea.value || props.placeholder || "x";
		if (hiddenTextarea.value.slice(-1) === "\n") hiddenTextarea.value += " ";
		const boxSizing = computedStyle.boxSizing;
		const padding = getStyleValue(computedStyle.paddingBottom) + getStyleValue(computedStyle.paddingTop);
		const border = getStyleValue(computedStyle.borderBottomWidth) + getStyleValue(computedStyle.borderTopWidth);
		const innerHeight = hiddenTextarea.scrollHeight;
		hiddenTextarea.value = "x";
		const singleRowHeight = hiddenTextarea.scrollHeight;
		let outerHeight = innerHeight;
		if (minRows) outerHeight = Math.max(Number(minRows) * singleRowHeight, outerHeight);
		if (maxRows) outerHeight = Math.min(Number(maxRows) * singleRowHeight, outerHeight);
		outerHeight = Math.max(outerHeight, singleRowHeight);
		return {
			outerHeightStyle: outerHeight + (boxSizing === "border-box" ? padding + border : 0),
			overflowing: Math.abs(outerHeight - innerHeight) <= 1
		};
	}, [
		maxRows,
		minRows,
		props.placeholder
	]);
	const didHeightChange = useEventCallback(() => {
		const textarea = textareaRef.current;
		const textareaStyles = calculateTextareaStyles();
		if (!textarea || !textareaStyles || isEmpty$1(textareaStyles)) return false;
		const outerHeightStyle = textareaStyles.outerHeightStyle;
		return heightRef.current != null && heightRef.current !== outerHeightStyle;
	});
	const syncHeight = import_react.useCallback(() => {
		const textarea = textareaRef.current;
		const textareaStyles = calculateTextareaStyles();
		if (!textarea || !textareaStyles || isEmpty$1(textareaStyles)) return;
		const outerHeightStyle = textareaStyles.outerHeightStyle;
		if (heightRef.current !== outerHeightStyle) {
			heightRef.current = outerHeightStyle;
			textarea.style.height = `${outerHeightStyle}px`;
		}
		textarea.style.overflow = textareaStyles.overflowing ? "hidden" : "";
	}, [calculateTextareaStyles]);
	const frameRef = import_react.useRef(-1);
	useEnhancedEffect(() => {
		const debouncedHandleResize = debounce(syncHeight);
		const textarea = textareaRef?.current;
		if (!textarea) return;
		const containerWindow = ownerWindow(textarea);
		containerWindow.addEventListener("resize", debouncedHandleResize);
		let resizeObserver;
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				if (didHeightChange()) {
					resizeObserver.unobserve(textarea);
					cancelAnimationFrame(frameRef.current);
					syncHeight();
					frameRef.current = requestAnimationFrame(() => {
						resizeObserver.observe(textarea);
					});
				}
			});
			resizeObserver.observe(textarea);
		}
		return () => {
			debouncedHandleResize.clear();
			cancelAnimationFrame(frameRef.current);
			containerWindow.removeEventListener("resize", debouncedHandleResize);
			if (resizeObserver) resizeObserver.disconnect();
		};
	}, [
		calculateTextareaStyles,
		syncHeight,
		didHeightChange
	]);
	useEnhancedEffect(() => {
		syncHeight();
	});
	const handleChange = (event) => {
		if (!isControlled) syncHeight();
		const textarea = event.target;
		const countOfCharacters = textarea.value.length;
		const isLastCharacterNewLine = textarea.value.endsWith("\n");
		const isEndOfTheLine = textarea.selectionStart === countOfCharacters;
		if (isLastCharacterNewLine && isEndOfTheLine) textarea.setSelectionRange(countOfCharacters, countOfCharacters);
		if (onChange) onChange(event);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
		value,
		onChange: handleChange,
		ref: handleRef,
		rows: minRows,
		style,
		...other
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
		"aria-hidden": true,
		className: props.className,
		readOnly: true,
		ref: hiddenTextareaRef,
		tabIndex: -1,
		style: {
			...styles$2.shadow,
			...style,
			paddingTop: 0,
			paddingBottom: 0
		}
	})] });
});
TextareaAutosize.propTypes = {
	className: import_prop_types.default.string,
	maxRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	minRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	onChange: import_prop_types.default.func,
	placeholder: import_prop_types.default.string,
	style: import_prop_types.default.object,
	value: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.string),
		import_prop_types.default.number,
		import_prop_types.default.string
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/FormControl/FormControlContext.mjs
/**
* @ignore - internal component.
*/
var FormControlContext = /* @__PURE__ */ import_react.createContext(void 0);
FormControlContext.displayName = "FormControlContext";
//#endregion
//#region frontend/node_modules/@mui/material/FormControl/useFormControl.mjs
function useFormControl() {
	return import_react.useContext(FormControlContext);
}
function useFormControlState({ props, states }) {
	const muiFormControl = import_react.useContext(FormControlContext);
	const result = {};
	states.forEach((state) => {
		const value = props[state];
		result[state] = value === void 0 && muiFormControl ? muiFormControl[state] : value;
	});
	return [result, muiFormControl];
}
//#endregion
//#region frontend/node_modules/@mui/material/InputBase/utils.mjs
function hasValue(value) {
	return value != null && !(Array.isArray(value) && value.length === 0);
}
function isFilled(obj, SSR = false) {
	return obj && (hasValue(obj.value) && obj.value !== "" || SSR && hasValue(obj.defaultValue) && obj.defaultValue !== "");
}
function isAdornedStart(obj) {
	return obj.startAdornment;
}
//#endregion
//#region frontend/node_modules/@mui/material/InputBase/InputBase.mjs
var _InputGlobalStyles;
var MUI_AUTO_FILL = "mui-auto-fill";
var MUI_AUTO_FILL_CANCEL = "mui-auto-fill-cancel";
var rootOverridesResolver = (props, styles) => {
	const { ownerState } = props;
	return [
		styles.root,
		ownerState.formControl && styles.formControl,
		ownerState.startAdornment && styles.adornedStart,
		ownerState.endAdornment && styles.adornedEnd,
		ownerState.error && styles.error,
		ownerState.size === "small" && styles.sizeSmall,
		ownerState.multiline && styles.multiline,
		ownerState.color && styles[`color${capitalize_default(ownerState.color)}`],
		ownerState.fullWidth && styles.fullWidth,
		ownerState.hiddenLabel && styles.hiddenLabel
	];
};
var inputOverridesResolver = (props, styles) => {
	const { ownerState } = props;
	return [styles.input, ownerState.type === "search" && styles.inputTypeSearch];
};
var useUtilityClasses$16 = (ownerState) => {
	const { classes, color, disabled, error, endAdornment, focused, formControl, fullWidth, hiddenLabel, multiline, readOnly, size, startAdornment, type } = ownerState;
	return composeClasses({
		root: [
			"root",
			`color${capitalize_default(color)}`,
			disabled && "disabled",
			error && "error",
			fullWidth && "fullWidth",
			focused && "focused",
			formControl && "formControl",
			size && size !== "medium" && `size${capitalize_default(size)}`,
			multiline && "multiline",
			startAdornment && "adornedStart",
			endAdornment && "adornedEnd",
			hiddenLabel && "hiddenLabel",
			readOnly && "readOnly"
		],
		input: [
			"input",
			disabled && "disabled",
			type === "search" && "inputTypeSearch",
			readOnly && "readOnly"
		]
	}, getInputBaseUtilityClass, classes);
};
var InputBaseRoot = styled("div", {
	name: "MuiInputBase",
	slot: "Root",
	overridesResolver: rootOverridesResolver
})(memoTheme(({ theme }) => ({
	...theme.typography.body1,
	color: (theme.vars || theme).palette.text.primary,
	lineHeight: "1.4375em",
	boxSizing: "border-box",
	position: "relative",
	cursor: "text",
	display: "inline-flex",
	alignItems: "center",
	[`&.${inputBaseClasses.disabled}`]: {
		color: (theme.vars || theme).palette.text.disabled,
		cursor: "default"
	},
	variants: [
		{
			props: ({ ownerState }) => ownerState.multiline,
			style: { padding: "4px 0 5px" }
		},
		{
			props: ({ ownerState, size }) => ownerState.multiline && size === "small",
			style: { paddingTop: 1 }
		},
		{
			props: ({ ownerState }) => ownerState.fullWidth,
			style: { width: "100%" }
		}
	]
})));
var InputBaseInput = styled("input", {
	name: "MuiInputBase",
	slot: "Input",
	overridesResolver: inputOverridesResolver
})(memoTheme(({ theme }) => {
	const light = theme.palette.mode === "light";
	const placeholder = {
		color: "currentColor",
		...theme.vars ? { opacity: theme.vars.opacity.inputPlaceholder } : { opacity: light ? .42 : .5 },
		...getTransitionStyles(theme, "opacity", { duration: theme.transitions.duration.shorter })
	};
	const placeholderHidden = { opacity: "0 !important" };
	const placeholderVisible = theme.vars ? { opacity: theme.vars.opacity.inputPlaceholder } : { opacity: light ? .42 : .5 };
	return {
		font: "inherit",
		letterSpacing: "inherit",
		color: "currentColor",
		padding: "4px 0 5px",
		border: 0,
		boxSizing: "content-box",
		background: "none",
		height: "1.4375em",
		margin: 0,
		WebkitTapHighlightColor: "transparent",
		display: "block",
		minWidth: 0,
		width: "100%",
		"&::-webkit-input-placeholder": placeholder,
		"&::-moz-placeholder": placeholder,
		"&::-ms-input-placeholder": placeholder,
		"&:focus": { outline: 0 },
		"&:invalid": { boxShadow: "none" },
		"&::-webkit-search-decoration": { WebkitAppearance: "none" },
		[`label[data-shrink=false] + .${inputBaseClasses.formControl} &`]: {
			"&::-webkit-input-placeholder": placeholderHidden,
			"&::-moz-placeholder": placeholderHidden,
			"&::-ms-input-placeholder": placeholderHidden,
			"&:focus::-webkit-input-placeholder": placeholderVisible,
			"&:focus::-moz-placeholder": placeholderVisible,
			"&:focus::-ms-input-placeholder": placeholderVisible
		},
		[`&.${inputBaseClasses.disabled}`]: {
			opacity: 1,
			WebkitTextFillColor: (theme.vars || theme).palette.text.disabled
		},
		variants: [
			{
				props: ({ ownerState }) => !ownerState.disableInjectingGlobalStyles,
				style: {
					animationName: MUI_AUTO_FILL_CANCEL,
					animationDuration: "10ms",
					"&:-webkit-autofill": {
						animationDuration: "5000s",
						animationName: MUI_AUTO_FILL
					}
				}
			},
			{
				props: { size: "small" },
				style: { paddingTop: 1 }
			},
			{
				props: ({ ownerState }) => ownerState.multiline,
				style: {
					height: "auto",
					resize: "none",
					padding: 0,
					paddingTop: 0
				}
			},
			{
				props: { type: "search" },
				style: { MozAppearance: "textfield" }
			}
		]
	};
}));
var InputGlobalStyles = globalCss({
	[`@keyframes ${MUI_AUTO_FILL}`]: { from: { animationName: MUI_AUTO_FILL } },
	[`@keyframes ${MUI_AUTO_FILL_CANCEL}`]: { from: { animationName: MUI_AUTO_FILL_CANCEL } }
});
/**
* `InputBase` contains as few styles as possible.
* It aims to be a simple building block for creating an input.
* It contains a load of style reset and some state logic.
*/
var InputBase = /* @__PURE__ */ import_react.forwardRef(function InputBase(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiInputBase"
	});
	const { "aria-describedby": ariaDescribedby, "aria-label": ariaLabel, autoComplete, autoFocus, className, color, defaultValue, disabled, disableInjectingGlobalStyles, endAdornment, error, fullWidth = false, id, inputComponent = "input", inputProps: inputPropsProp = {}, inputRef: inputRefProp, margin, maxRows, minRows, multiline = false, name, onBlur, onChange, onClick, onFocus, onKeyDown, onKeyUp, placeholder, readOnly, renderSuffix, rows, size, slotProps = {}, slots = {}, startAdornment, type = "text", value: valueProp, ...other } = props;
	const value = inputPropsProp.value != null ? inputPropsProp.value : valueProp;
	const { current: isControlled } = import_react.useRef(value != null);
	const inputRef = import_react.useRef();
	const handleInputRefWarning = import_react.useCallback((instance) => {
		if (instance && instance.nodeName !== "INPUT" && !instance.focus) console.error([
			"MUI: You have provided a `inputComponent` to the input component",
			"that does not correctly handle the `ref` prop.",
			"Make sure the `ref` prop is called with a HTMLInputElement."
		].join("\n"));
	}, []);
	const handleInputRef = useForkRef_default(inputRef, inputRefProp, inputPropsProp.ref, handleInputRefWarning);
	const [focused, setFocused] = import_react.useState(false);
	const [fcs, muiFormControl] = useFormControlState({
		props,
		states: [
			"color",
			"disabled",
			"error",
			"hiddenLabel",
			"size",
			"required",
			"filled"
		]
	});
	import_react.useEffect(() => {
		if (muiFormControl) return muiFormControl.registerEffect();
	}, [muiFormControl]);
	fcs.focused = muiFormControl ? muiFormControl.focused : focused;
	import_react.useEffect(() => {
		if (!muiFormControl && disabled && focused) {
			setFocused(false);
			if (onBlur) onBlur();
		}
	}, [
		muiFormControl,
		disabled,
		focused,
		onBlur
	]);
	const onFilled = muiFormControl && muiFormControl.onFilled;
	const onEmpty = muiFormControl && muiFormControl.onEmpty;
	const checkDirty = import_react.useCallback((obj) => {
		if (isFilled(obj)) {
			if (onFilled) onFilled();
		} else if (onEmpty) onEmpty();
	}, [onFilled, onEmpty]);
	useEnhancedEffect_default(() => {
		if (isControlled) checkDirty({ value });
	}, [
		value,
		checkDirty,
		isControlled
	]);
	useEnhancedEffect_default(() => {
		if (!autoFocus) return;
		const input = inputRef.current;
		if (!input) return;
		const doc = ownerDocument_default(input);
		const activeElement = getActiveElement_default(doc);
		const noElementFocused = activeElement == null || activeElement === doc.body || activeElement === doc.documentElement;
		if (input === activeElement) if (muiFormControl && muiFormControl.onFocus) muiFormControl.onFocus();
		else setFocused(true);
		else if (noElementFocused) input.focus();
	}, [autoFocus]);
	const handleFocus = (event) => {
		if (onFocus) onFocus(event);
		if (inputPropsProp.onFocus) inputPropsProp.onFocus(event);
		if (muiFormControl && muiFormControl.onFocus) muiFormControl.onFocus(event);
		else setFocused(true);
	};
	const handleBlur = (event) => {
		if (onBlur) onBlur(event);
		if (inputPropsProp.onBlur) inputPropsProp.onBlur(event);
		if (muiFormControl && muiFormControl.onBlur) muiFormControl.onBlur(event);
		else setFocused(false);
	};
	const handleChange = (event, ...args) => {
		if (!isControlled) {
			const element = event.target || inputRef.current;
			if (element == null) throw new Error("MUI: Expected valid input target. Did you use a custom `inputComponent` and forget to forward refs? See https://mui.com/r/input-component-ref-interface for more info.");
			checkDirty({ value: element.value });
		}
		if (inputPropsProp.onChange) inputPropsProp.onChange(event, ...args);
		if (onChange) onChange(event, ...args);
	};
	import_react.useEffect(() => {
		checkDirty(inputRef.current);
	}, []);
	const handleClick = (event) => {
		if (inputRef.current && event.currentTarget === event.target) inputRef.current.focus();
		if (onClick) onClick(event);
	};
	let InputComponent = inputComponent;
	let inputProps = inputPropsProp;
	if (multiline && InputComponent === "input") {
		if (rows) {
			if (minRows || maxRows) console.warn("MUI: You can not use the `minRows` or `maxRows` props when the input `rows` prop is set.");
			inputProps = {
				type: void 0,
				minRows: rows,
				maxRows: rows,
				...inputProps
			};
		} else inputProps = {
			type: void 0,
			maxRows,
			minRows,
			...inputProps
		};
		InputComponent = TextareaAutosize;
	}
	const handleAutoFill = (event) => {
		checkDirty(event.animationName === MUI_AUTO_FILL_CANCEL ? inputRef.current : { value: "x" });
	};
	import_react.useEffect(() => {
		if (muiFormControl) muiFormControl.setAdornedStart(Boolean(startAdornment));
	}, [muiFormControl, startAdornment]);
	const ownerState = {
		...props,
		color: fcs.color || "primary",
		disabled: fcs.disabled,
		endAdornment,
		error: fcs.error,
		focused: fcs.focused,
		formControl: muiFormControl,
		fullWidth,
		hiddenLabel: fcs.hiddenLabel,
		multiline,
		size: fcs.size,
		startAdornment,
		type
	};
	const classes = useUtilityClasses$16(ownerState);
	const Root = slots.root || InputBaseRoot;
	const rootProps = slotProps.root || {};
	const Input = slots.input || InputBaseInput;
	inputProps = {
		...inputProps,
		...slotProps.input
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [!disableInjectingGlobalStyles && typeof InputGlobalStyles === "function" && (_InputGlobalStyles || (_InputGlobalStyles = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputGlobalStyles, {}))), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Root, {
		...rootProps,
		ref,
		onClick: handleClick,
		...other,
		...!isHostComponent(Root) && { ownerState: {
			...ownerState,
			...rootProps.ownerState
		} },
		className: clsx(classes.root, rootProps.className, className, readOnly && "MuiInputBase-readOnly"),
		children: [
			startAdornment,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormControlContext.Provider, {
				value: null,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					"aria-invalid": fcs.error,
					"aria-describedby": ariaDescribedby,
					"aria-label": ariaLabel,
					autoComplete,
					autoFocus,
					defaultValue,
					disabled: fcs.disabled,
					id,
					onAnimationStart: handleAutoFill,
					name,
					placeholder,
					readOnly,
					required: fcs.required,
					rows,
					value,
					onKeyDown,
					onKeyUp,
					type,
					...inputProps,
					...!isHostComponent(Input) && {
						as: InputComponent,
						ownerState: {
							...ownerState,
							...inputProps.ownerState
						}
					},
					ref: handleInputRef,
					className: clsx(classes.input, inputProps.className, readOnly && "MuiInputBase-readOnly"),
					onBlur: handleBlur,
					onChange: handleChange,
					onFocus: handleFocus
				})
			}),
			endAdornment,
			renderSuffix ? renderSuffix({
				...fcs,
				startAdornment
			}) : null
		]
	})] });
});
InputBase.propTypes = {
	"aria-describedby": import_prop_types.default.string,
	"aria-label": import_prop_types.default.string,
	autoComplete: import_prop_types.default.string,
	autoFocus: import_prop_types.default.bool,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"primary",
		"secondary",
		"error",
		"info",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	defaultValue: import_prop_types.default.any,
	disabled: import_prop_types.default.bool,
	disableInjectingGlobalStyles: import_prop_types.default.bool,
	endAdornment: import_prop_types.default.node,
	error: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	id: import_prop_types.default.string,
	inputComponent: elementTypeAcceptingRef_default,
	inputProps: import_prop_types.default.object,
	inputRef: refType,
	margin: import_prop_types.default.oneOf(["dense", "none"]),
	maxRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	minRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	multiline: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	onBlur: import_prop_types.default.func,
	onChange: import_prop_types.default.func,
	onClick: import_prop_types.default.func,
	onFocus: import_prop_types.default.func,
	onInvalid: import_prop_types.default.func,
	onKeyDown: import_prop_types.default.func,
	onKeyUp: import_prop_types.default.func,
	placeholder: import_prop_types.default.string,
	readOnly: import_prop_types.default.bool,
	renderSuffix: import_prop_types.default.func,
	required: import_prop_types.default.bool,
	rows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["medium", "small"]), import_prop_types.default.string]),
	slotProps: import_prop_types.default.shape({
		input: import_prop_types.default.object,
		root: import_prop_types.default.object
	}),
	slots: import_prop_types.default.shape({
		input: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType
	}),
	startAdornment: import_prop_types.default.node,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	type: import_prop_types.default.string,
	value: import_prop_types.default.any
};
//#endregion
//#region frontend/node_modules/@mui/material/FormHelperText/formHelperTextClasses.mjs
function getFormHelperTextUtilityClasses(slot) {
	return generateUtilityClass("MuiFormHelperText", slot);
}
var formHelperTextClasses = generateUtilityClasses("MuiFormHelperText", [
	"root",
	"error",
	"disabled",
	"sizeSmall",
	"sizeMedium",
	"contained",
	"focused",
	"filled",
	"required"
]);
//#endregion
//#region frontend/node_modules/@mui/material/FormLabel/formLabelClasses.mjs
function getFormLabelUtilityClasses(slot) {
	return generateUtilityClass("MuiFormLabel", slot);
}
var formLabelClasses = generateUtilityClasses("MuiFormLabel", [
	"root",
	"colorSecondary",
	"focused",
	"disabled",
	"error",
	"filled",
	"required",
	"asterisk"
]);
//#endregion
//#region frontend/node_modules/@mui/material/NativeSelect/nativeSelectClasses.mjs
function getNativeSelectUtilityClasses(slot) {
	return generateUtilityClass("MuiNativeSelect", slot);
}
var nativeSelectClasses = generateUtilityClasses("MuiNativeSelect", [
	"root",
	"select",
	"multiple",
	"filled",
	"outlined",
	"standard",
	"disabled",
	"icon",
	"iconOpen",
	"iconFilled",
	"iconOutlined",
	"iconStandard",
	"nativeInput",
	"error"
]);
//#endregion
//#region frontend/node_modules/@mui/utils/useValueAsRef/useValueAsRef.mjs
/**
* Copied from `@base-ui/utils/useValueAsRef`.
*
* Stores the latest value in a stable ref. The ref updates after React commits,
* so effects and delayed callbacks can read the current value without depending
* on it and rerunning.
*/
function useValueAsRef(value) {
	const latest = useLazyRef(() => createValueRef(value)).current;
	latest.next = value;
	useEnhancedEffect(latest.effect);
	return latest;
}
function createValueRef(value) {
	const latest = {
		current: value,
		next: value,
		effect: () => {
			latest.current = latest.next;
		}
	};
	return latest;
}
//#endregion
//#region frontend/node_modules/react-transition-group/esm/TransitionGroupContext.js
var TransitionGroupContext_default = import_react.createContext(null);
//#endregion
//#region frontend/node_modules/@mui/material/internal/Transition.mjs
function resolveTimeouts(timeout) {
	if (timeout == null) return {
		appear: void 0,
		enter: void 0,
		exit: void 0
	};
	if (typeof timeout === "number") return {
		appear: timeout,
		enter: timeout,
		exit: timeout
	};
	const enter = timeout.enter;
	const exit = timeout.exit;
	return {
		appear: timeout.appear !== void 0 ? timeout.appear : enter,
		enter,
		exit
	};
}
/**
* Resolves the authored completion timeout for the current transition phase.
* Auto durations are read by the caller at scheduling time so Grow/Collapse
* can pass the latest measured value without storing it in React state.
*/
function getCompletionTimeout(params) {
	if (params.autoTimeout != null) return params.autoTimeout;
	const resolved = resolveTimeouts(params.timeout);
	if (params.currentStatus === "entering") return params.isAppearing ? resolved.appear ?? resolved.enter ?? null : resolved.enter ?? null;
	return resolved.exit ?? null;
}
function Transition(props) {
	const { in: inProp = false, appear = false, enter = true, exit = true, mountOnEnter = false, unmountOnExit = false, timeout, addEndListener, reduceMotion = false, getAutoTimeout, nodeRef, onEnter, onEntering, onEntered, onExit, onExiting, onExited, children, ...childProps } = props;
	const parentGroup = import_react.useContext(TransitionGroupContext_default);
	const shouldEnterOnMount = parentGroup && !parentGroup.isMounting ? enter : appear;
	const [status, setStatus] = import_react.useState(() => {
		if (inProp) return shouldEnterOnMount ? "exited" : "entered";
		if (mountOnEnter || unmountOnExit) return "unmounted";
		return "exited";
	});
	const statusRef = import_react.useRef(status);
	statusRef.current = status;
	if (inProp && status === "unmounted") {
		statusRef.current = "exited";
		setStatus("exited");
	}
	const shouldAppearOnMountRef = import_react.useRef(inProp && shouldEnterOnMount);
	const mountedRef = import_react.useRef(false);
	const nextCallbackRef = import_react.useRef(null);
	const lastFiredStatusRef = import_react.useRef(status);
	const isAppearingRef = import_react.useRef(false);
	const transitionReduceMotionRef = import_react.useRef(reduceMotion);
	const propsRef = useValueAsRef({
		timeout,
		addEndListener,
		reduceMotion,
		getAutoTimeout,
		onEnter,
		onEntering,
		onEntered,
		onExit,
		onExiting,
		onExited,
		enter,
		exit,
		mountOnEnter,
		unmountOnExit,
		nodeRef,
		parentGroup
	});
	const cancelPendingCallback = import_react.useCallback(() => {
		if (nextCallbackRef.current !== null) {
			nextCallbackRef.current.cancel();
			nextCallbackRef.current = null;
		}
	}, []);
	const makeCallback = import_react.useCallback((handler) => {
		let active = true;
		const wrapped = () => {
			if (active) {
				active = false;
				nextCallbackRef.current = null;
				handler();
			}
		};
		wrapped.cancel = () => {
			active = false;
		};
		nextCallbackRef.current = wrapped;
		return wrapped;
	}, []);
	const scheduleTransitionEnd = import_react.useCallback((nextStatus, currentStatus) => {
		let timeoutId;
		const clearTimer = () => {
			if (timeoutId !== void 0) {
				clearTimeout(timeoutId);
				timeoutId = void 0;
			}
		};
		const done = makeCallback(() => {
			clearTimer();
			statusRef.current = nextStatus;
			setStatus(nextStatus);
		});
		const cancelDone = done.cancel;
		done.cancel = () => {
			clearTimer();
			cancelDone();
		};
		const node = propsRef.current.nodeRef.current;
		const listener = propsRef.current.addEndListener;
		const hasAutoTimeout = propsRef.current.getAutoTimeout !== void 0;
		const autoTimeout = propsRef.current.getAutoTimeout?.();
		const authoredTimeout = getCompletionTimeout({
			currentStatus,
			isAppearing: isAppearingRef.current,
			timeout: propsRef.current.timeout,
			autoTimeout
		});
		const transitionReduceMotion = transitionReduceMotionRef.current;
		const fallbackTimeout = authoredTimeout ?? (transitionReduceMotion && hasAutoTimeout ? 0 : null);
		const scheduleTimer = (value) => {
			timeoutId = setTimeout(done, value);
		};
		if (!node) {
			console.warn([
				"MUI: The transition child does not expose a DOM element.",
				"Make sure the child accepts a ref and forwards it to the underlying DOM element.",
				"The transition animation cannot be observed without a DOM element and will be skipped."
			].join("\n"));
			scheduleTimer(0);
			return;
		}
		if (listener) {
			if (fallbackTimeout != null) scheduleTimer(transitionReduceMotion ? 0 : fallbackTimeout);
			if (listener.length >= 2) listener(node, done);
			else listener(done);
			return;
		}
		scheduleTimer(transitionReduceMotion ? 0 : authoredTimeout ?? 0);
	}, [makeCallback, propsRef]);
	const performEnter = import_react.useCallback((mounting) => {
		const current = propsRef.current;
		const isAppearing = current.parentGroup ? current.parentGroup.isMounting : mounting;
		isAppearingRef.current = isAppearing;
		if (!mounting && !current.enter) {
			statusRef.current = "entered";
			setStatus("entered");
			return;
		}
		transitionReduceMotionRef.current = current.reduceMotion;
		current.onEnter?.(isAppearing);
		statusRef.current = "entering";
		setStatus("entering");
	}, [propsRef]);
	const performExit = import_react.useCallback(() => {
		const current = propsRef.current;
		if (!current.exit) {
			statusRef.current = "exited";
			setStatus("exited");
			return;
		}
		transitionReduceMotionRef.current = current.reduceMotion;
		current.onExit?.();
		statusRef.current = "exiting";
		setStatus("exiting");
	}, [propsRef]);
	const updateStatus = import_react.useCallback((mounting, nextStatus) => {
		cancelPendingCallback();
		if (nextStatus === "entering") {
			const current = propsRef.current;
			if (current.mountOnEnter || current.unmountOnExit) {
				const node = current.nodeRef.current;
				if (node) reflow(node);
			}
			performEnter(mounting);
		} else performExit();
	}, [
		cancelPendingCallback,
		performEnter,
		performExit,
		propsRef
	]);
	useEnhancedEffect(() => {
		mountedRef.current = true;
		if (shouldAppearOnMountRef.current) {
			shouldAppearOnMountRef.current = false;
			updateStatus(true, "entering");
		}
		return () => {
			mountedRef.current = false;
			cancelPendingCallback();
		};
	}, [cancelPendingCallback, updateStatus]);
	useEnhancedEffect(() => {
		if (!mountedRef.current) return;
		const current = statusRef.current;
		if (inProp) {
			if (current !== "entering" && current !== "entered") updateStatus(false, "entering");
		} else if (current === "entering" || current === "entered") updateStatus(false, "exiting");
		else if (current === "exited" && unmountOnExit) {
			statusRef.current = "unmounted";
			setStatus("unmounted");
		}
	}, [
		inProp,
		status,
		unmountOnExit,
		updateStatus
	]);
	useEnhancedEffect(() => {
		if (status === "unmounted" || lastFiredStatusRef.current === "unmounted") {
			lastFiredStatusRef.current = status;
			return;
		}
		if (lastFiredStatusRef.current === status) return;
		lastFiredStatusRef.current = status;
		const current = propsRef.current;
		if (status === "entering") {
			current.onEntering?.(isAppearingRef.current);
			scheduleTransitionEnd("entered", "entering");
		} else if (status === "exiting") {
			current.onExiting?.();
			scheduleTransitionEnd("exited", "exiting");
		} else if (status === "entered") current.onEntered?.(isAppearingRef.current);
		else if (status === "exited") current.onExited?.();
	}, [
		propsRef,
		scheduleTransitionEnd,
		status
	]);
	if (status === "unmounted") return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TransitionGroupContext_default.Provider, {
		value: null,
		children: children(status, childProps)
	});
}
Transition.propTypes = {
	addEndListener: import_prop_types.default.func,
	appear: import_prop_types.default.bool,
	children: import_prop_types.default.func.isRequired,
	enter: import_prop_types.default.bool,
	exit: import_prop_types.default.bool,
	getAutoTimeout: import_prop_types.default.func,
	in: import_prop_types.default.bool,
	mountOnEnter: import_prop_types.default.bool,
	nodeRef: import_prop_types.default.shape({ current: (props, propName) => {
		if (props[propName] == null) return null;
		if (typeof props[propName] !== "object" || props[propName].nodeType !== 1) return /* @__PURE__ */ new Error(`Expected prop '${propName}' to be of type Element`);
		return null;
	} }).isRequired,
	onEnter: import_prop_types.default.func,
	onEntered: import_prop_types.default.func,
	onEntering: import_prop_types.default.func,
	onExit: import_prop_types.default.func,
	onExited: import_prop_types.default.func,
	onExiting: import_prop_types.default.func,
	reduceMotion: import_prop_types.default.bool,
	timeout: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.shape({
		appear: import_prop_types.default.number,
		enter: import_prop_types.default.number,
		exit: import_prop_types.default.number
	})]),
	unmountOnExit: import_prop_types.default.bool
};
//#endregion
//#region frontend/node_modules/@mui/utils/elementAcceptingRef/elementAcceptingRef.mjs
function isClassComponent(elementType) {
	const { prototype = {} } = elementType;
	return Boolean(prototype.isReactComponent);
}
function acceptingRef(props, propName, componentName, location, propFullName) {
	const element = props[propName];
	const safePropName = propFullName || propName;
	if (element == null || typeof window === "undefined") return null;
	let warningHint;
	const elementType = element.type;
	/**
	* Blacklisting instead of whitelisting
	*
	* Blacklisting will miss some components, such as React.Fragment. Those will at least
	* trigger a warning in React.
	* We can't whitelist because there is no safe way to detect React.forwardRef
	* or class components. "Safe" means there's no public API.
	*
	*/
	if (typeof elementType === "function" && !isClassComponent(elementType)) warningHint = "Did you accidentally use a plain function component for an element instead?";
	if (warningHint !== void 0) return /* @__PURE__ */ new Error(`Invalid ${location} \`${safePropName}\` supplied to \`${componentName}\`. Expected an element that can hold a ref. ${warningHint} For more information see https://mui.com/r/caveat-with-refs-guide`);
	return null;
}
var elementAcceptingRef = chainPropTypes(import_prop_types.default.element, acceptingRef);
elementAcceptingRef.isRequired = chainPropTypes(import_prop_types.default.element.isRequired, acceptingRef);
//#endregion
//#region frontend/node_modules/@mui/material/Fade/Fade.mjs
var styles$1 = {
	entering: { opacity: 1 },
	entered: { opacity: 1 },
	exiting: { opacity: 0 },
	exited: { opacity: 0 }
};
var hiddenStyles$1 = {
	opacity: 0,
	visibility: "hidden"
};
/**
* The Fade transition is used by the [Modal](/material-ui/react-modal/) component.
*/
var Fade = /* @__PURE__ */ import_react.forwardRef(function Fade(props, ref) {
	const theme = useTheme();
	const defaultTimeout = {
		enter: theme.transitions.duration.enteringScreen,
		exit: theme.transitions.duration.leavingScreen
	};
	const { addEndListener, appear = true, children, disablePrefersReducedMotion = false, easing, in: inProp, onEnter, onEntered, onEntering, onExit, onExited, onExiting, style, timeout = defaultTimeout, ...other } = props;
	const reducedMotion = useReducedMotion(theme.motion.reducedMotion, disablePrefersReducedMotion);
	const nodeRef = import_react.useRef(null);
	const handleRef = useForkRef_default(nodeRef, getReactElementRef(children), ref);
	const handleEntering = normalizedTransitionCallback(nodeRef, onEntering);
	const handleEnter = normalizedTransitionCallback(nodeRef, (node, isAppearing) => {
		if (!reducedMotion.shouldReduceMotion) reflow(node);
		const transitionProps = getTransitionProps({
			style,
			timeout,
			easing
		}, { mode: "enter" });
		const transitionTiming = reducedMotion.getTransitionTiming({
			duration: transitionProps.duration,
			delay: transitionProps.delay
		});
		node.style.transition = theme.transitions.create("opacity", {
			duration: transitionTiming.duration,
			easing: transitionProps.easing,
			delay: transitionTiming.delay
		});
		if (onEnter) onEnter(node, isAppearing);
	});
	const handleEntered = normalizedTransitionCallback(nodeRef, onEntered);
	const handleExiting = normalizedTransitionCallback(nodeRef, onExiting);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Transition, {
		appear,
		in: inProp,
		nodeRef,
		onEnter: handleEnter,
		onEntered: handleEntered,
		onEntering: handleEntering,
		onExit: normalizedTransitionCallback(nodeRef, (node) => {
			const transitionProps = getTransitionProps({
				style,
				timeout,
				easing
			}, { mode: "exit" });
			const transitionTiming = reducedMotion.getTransitionTiming({
				duration: transitionProps.duration,
				delay: transitionProps.delay
			});
			node.style.transition = theme.transitions.create("opacity", {
				duration: transitionTiming.duration,
				easing: transitionProps.easing,
				delay: transitionTiming.delay
			});
			if (onExit) onExit(node);
		}),
		onExited: normalizedTransitionCallback(nodeRef, (node) => {
			node.style.transition = "";
			if (onExited) onExited(node);
		}),
		onExiting: handleExiting,
		addEndListener: addEndListener ? (next) => {
			addEndListener(nodeRef.current, next);
		} : void 0,
		reduceMotion: reducedMotion.shouldReduceMotion,
		timeout,
		...other,
		children: (state, { ownerState, ...restChildProps }) => {
			const childStyle = getTransitionChildStyle(state, inProp, styles$1, hiddenStyles$1, style, children.props.style);
			return /* @__PURE__ */ import_react.cloneElement(children, {
				style: childStyle,
				ref: handleRef,
				...restChildProps
			});
		}
	});
});
Fade.propTypes = {
	addEndListener: import_prop_types.default.func,
	appear: import_prop_types.default.bool,
	children: elementAcceptingRef.isRequired,
	disablePrefersReducedMotion: import_prop_types.default.bool,
	easing: import_prop_types.default.oneOfType([import_prop_types.default.shape({
		enter: import_prop_types.default.string,
		exit: import_prop_types.default.string
	}), import_prop_types.default.string]),
	in: import_prop_types.default.bool,
	onEnter: import_prop_types.default.func,
	onEntered: import_prop_types.default.func,
	onEntering: import_prop_types.default.func,
	onExit: import_prop_types.default.func,
	onExited: import_prop_types.default.func,
	onExiting: import_prop_types.default.func,
	style: import_prop_types.default.object,
	timeout: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.shape({
		appear: import_prop_types.default.number,
		enter: import_prop_types.default.number,
		exit: import_prop_types.default.number
	})])
};
//#endregion
//#region frontend/node_modules/@mui/material/Backdrop/backdropClasses.mjs
function getBackdropUtilityClass(slot) {
	return generateUtilityClass("MuiBackdrop", slot);
}
var backdropClasses = generateUtilityClasses("MuiBackdrop", ["root", "invisible"]);
//#endregion
//#region frontend/node_modules/@mui/material/Backdrop/Backdrop.mjs
var useUtilityClasses$15 = (ownerState) => {
	const { classes, invisible } = ownerState;
	return composeClasses({ root: ["root", invisible && "invisible"] }, getBackdropUtilityClass, classes);
};
var BackdropRoot = styled("div", {
	name: "MuiBackdrop",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [styles.root, ownerState.invisible && styles.invisible];
	}
})({
	position: "fixed",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	right: 0,
	bottom: 0,
	top: 0,
	left: 0,
	backgroundColor: "rgba(0, 0, 0, 0.5)",
	WebkitTapHighlightColor: "transparent",
	variants: [{
		props: { invisible: true },
		style: { backgroundColor: "transparent" }
	}]
});
var Backdrop = /* @__PURE__ */ import_react.forwardRef(function Backdrop(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiBackdrop"
	});
	const { children, className, component = "div", invisible = false, open, slotProps = {}, slots = {}, transitionDuration, ...other } = props;
	const ownerState = {
		...props,
		component,
		invisible
	};
	const classes = useUtilityClasses$15(ownerState);
	const externalForwardedProps = {
		component,
		slots,
		slotProps
	};
	const [RootSlot, rootProps] = useSlot("root", {
		elementType: BackdropRoot,
		externalForwardedProps,
		className: clsx(classes.root, className),
		ownerState
	});
	const [TransitionSlot, transitionProps] = useSlot("transition", {
		elementType: Fade,
		externalForwardedProps,
		ownerState
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TransitionSlot, {
		in: open,
		timeout: transitionDuration,
		...other,
		...transitionProps,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RootSlot, {
			...rootProps,
			ref,
			children
		})
	});
});
Backdrop.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	component: import_prop_types.default.elementType,
	invisible: import_prop_types.default.bool,
	open: import_prop_types.default.bool.isRequired,
	slotProps: import_prop_types.default.shape({
		root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		transition: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		root: import_prop_types.default.elementType,
		transition: import_prop_types.default.elementType
	}),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	transitionDuration: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.shape({
		appear: import_prop_types.default.number,
		enter: import_prop_types.default.number,
		exit: import_prop_types.default.number
	})])
};
//#endregion
//#region frontend/node_modules/@mui/utils/getScrollbarSize/getScrollbarSize.mjs
function getScrollbarSize(win = window) {
	const documentWidth = win.document.documentElement.clientWidth;
	return win.innerWidth - documentWidth;
}
//#endregion
//#region frontend/node_modules/@mui/material/Modal/ModalManager.mjs
function isOverflowing(container) {
	const doc = ownerDocument(container);
	if (doc.body === container) return ownerWindow(container).innerWidth > doc.documentElement.clientWidth;
	return container.scrollHeight > container.clientHeight;
}
function ariaHidden(element, hide) {
	if (hide) element.setAttribute("aria-hidden", "true");
	else element.removeAttribute("aria-hidden");
}
function getPaddingRight(element) {
	return parseFloat(ownerWindow(element).getComputedStyle(element).paddingRight) || 0;
}
function isAriaHiddenForbiddenOnElement(element) {
	const isForbiddenTagName = [
		"TEMPLATE",
		"SCRIPT",
		"STYLE",
		"LINK",
		"MAP",
		"META",
		"NOSCRIPT",
		"PICTURE",
		"COL",
		"COLGROUP",
		"PARAM",
		"SLOT",
		"SOURCE",
		"TRACK"
	].includes(element.tagName);
	const isInputHidden = element.tagName === "INPUT" && element.getAttribute("type") === "hidden";
	return isForbiddenTagName || isInputHidden;
}
function ariaHiddenSiblings(container, mountElement, currentElement, elementsToExclude, hide) {
	const blacklist = [
		mountElement,
		currentElement,
		...elementsToExclude
	];
	[].forEach.call(container.children, (element) => {
		const isNotExcludedElement = !blacklist.includes(element);
		const isNotForbiddenElement = !isAriaHiddenForbiddenOnElement(element);
		if (isNotExcludedElement && isNotForbiddenElement) ariaHidden(element, hide);
	});
}
function findIndexOf(items, callback) {
	let idx = -1;
	items.some((item, index) => {
		if (callback(item)) {
			idx = index;
			return true;
		}
		return false;
	});
	return idx;
}
function handleContainer(containerInfo, props) {
	const restoreStyle = [];
	const container = containerInfo.container;
	if (!props.disableScrollLock) {
		if (isOverflowing(container)) {
			const scrollbarSize = getScrollbarSize(ownerWindow(container));
			restoreStyle.push({
				value: container.style.paddingRight,
				property: "padding-right",
				el: container
			});
			container.style.paddingRight = `${getPaddingRight(container) + scrollbarSize}px`;
			const fixedElements = ownerDocument(container).querySelectorAll(".mui-fixed");
			[].forEach.call(fixedElements, (element) => {
				restoreStyle.push({
					value: element.style.paddingRight,
					property: "padding-right",
					el: element
				});
				element.style.paddingRight = `${getPaddingRight(element) + scrollbarSize}px`;
			});
		}
		let scrollContainer;
		if (container.parentNode instanceof DocumentFragment) scrollContainer = ownerDocument(container).body;
		else {
			const parent = container.parentElement;
			const containerWindow = ownerWindow(container);
			scrollContainer = parent?.nodeName === "HTML" && containerWindow.getComputedStyle(parent).overflowY === "scroll" ? parent : container;
		}
		restoreStyle.push({
			value: scrollContainer.style.overflow,
			property: "overflow",
			el: scrollContainer
		}, {
			value: scrollContainer.style.overflowX,
			property: "overflow-x",
			el: scrollContainer
		}, {
			value: scrollContainer.style.overflowY,
			property: "overflow-y",
			el: scrollContainer
		});
		scrollContainer.style.overflow = "hidden";
	}
	const restore = () => {
		restoreStyle.forEach(({ value, el, property }) => {
			if (value) el.style.setProperty(property, value);
			else el.style.removeProperty(property);
		});
	};
	return restore;
}
function getHiddenSiblings(container) {
	const hiddenSiblings = [];
	[].forEach.call(container.children, (element) => {
		if (element.getAttribute("aria-hidden") === "true") hiddenSiblings.push(element);
	});
	return hiddenSiblings;
}
/**
* @ignore - do not document.
*
* Proper state management for containers and the modals in those containers.
* Simplified, but inspired by react-overlay's ModalManager class.
* Used by the Modal to ensure proper styling of containers.
*/
var ModalManager = class {
	constructor() {
		this.modals = [];
		this.containers = [];
	}
	add(modal, container) {
		let modalIndex = this.modals.indexOf(modal);
		if (modalIndex !== -1) return modalIndex;
		modalIndex = this.modals.length;
		this.modals.push(modal);
		if (modal.modalRef) ariaHidden(modal.modalRef, false);
		const hiddenSiblings = getHiddenSiblings(container);
		ariaHiddenSiblings(container, modal.mount, modal.modalRef, hiddenSiblings, true);
		const containerIndex = findIndexOf(this.containers, (item) => item.container === container);
		if (containerIndex !== -1) {
			this.containers[containerIndex].modals.push(modal);
			return modalIndex;
		}
		this.containers.push({
			modals: [modal],
			container,
			restore: null,
			hiddenSiblings
		});
		return modalIndex;
	}
	mount(modal, props) {
		const containerIndex = findIndexOf(this.containers, (item) => item.modals.includes(modal));
		const containerInfo = this.containers[containerIndex];
		if (!containerInfo.restore) containerInfo.restore = handleContainer(containerInfo, props);
	}
	remove(modal, ariaHiddenState = true) {
		const modalIndex = this.modals.indexOf(modal);
		if (modalIndex === -1) return modalIndex;
		const containerIndex = findIndexOf(this.containers, (item) => item.modals.includes(modal));
		const containerInfo = this.containers[containerIndex];
		containerInfo.modals.splice(containerInfo.modals.indexOf(modal), 1);
		this.modals.splice(modalIndex, 1);
		if (containerInfo.modals.length === 0) {
			if (containerInfo.restore) containerInfo.restore();
			if (modal.modalRef) ariaHidden(modal.modalRef, ariaHiddenState);
			ariaHiddenSiblings(containerInfo.container, modal.mount, modal.modalRef, containerInfo.hiddenSiblings, false);
			this.containers.splice(containerIndex, 1);
		} else {
			const nextTop = containerInfo.modals[containerInfo.modals.length - 1];
			if (nextTop.modalRef) ariaHidden(nextTop.modalRef, false);
		}
		return modalIndex;
	}
	isTopModal(modal) {
		return this.modals.length > 0 && this.modals[this.modals.length - 1] === modal;
	}
};
//#endregion
//#region frontend/node_modules/@mui/material/utils/contains.mjs
var contains_default = contains;
//#endregion
//#region frontend/node_modules/@mui/material/utils/focusable.mjs
var FOCUSABLE_ATTRIBUTE = "data-mui-focusable";
/**
* Returns the element marked as the initial focus target inside a focus trap.
* The root element takes precedence over marked descendants so components can
* opt into focusing their own root surface directly.
*/
function getFocusTarget(rootElement) {
	if (!rootElement) return null;
	return rootElement.hasAttribute("data-mui-focusable") ? rootElement : rootElement.querySelector(`[${FOCUSABLE_ATTRIBUTE}]`);
}
//#endregion
//#region frontend/node_modules/@mui/material/Unstable_TrapFocus/FocusTrap.mjs
var candidatesSelector = [
	"input",
	"select",
	"textarea",
	"a[href]",
	"button",
	"[tabindex]",
	"audio[controls]",
	"video[controls]",
	"[contenteditable]:not([contenteditable=\"false\"])"
].join(",");
function getTabIndex(node) {
	const tabindexAttr = parseInt(node.getAttribute("tabindex") || "", 10);
	if (!Number.isNaN(tabindexAttr)) return tabindexAttr;
	if (node.contentEditable === "true" || (node.nodeName === "AUDIO" || node.nodeName === "VIDEO" || node.nodeName === "DETAILS") && node.getAttribute("tabindex") === null) return 0;
	return node.tabIndex;
}
function isNonTabbableRadio(node) {
	if (node.tagName !== "INPUT" || node.type !== "radio") return false;
	if (!node.name) return false;
	const getRadio = (selector) => node.ownerDocument.querySelector(`input[type="radio"]${selector}`);
	let roving = getRadio(`[name="${node.name}"]:checked`);
	if (!roving) roving = getRadio(`[name="${node.name}"]`);
	return roving !== node;
}
function isNodeMatchingSelectorFocusable(node) {
	if (node.disabled || node.tagName === "INPUT" && node.type === "hidden" || isNonTabbableRadio(node)) return false;
	return true;
}
function defaultGetTabbable(root) {
	const regularTabNodes = [];
	const orderedTabNodes = [];
	Array.from(root.querySelectorAll(candidatesSelector)).forEach((node, i) => {
		const nodeTabIndex = getTabIndex(node);
		if (nodeTabIndex === -1 || !isNodeMatchingSelectorFocusable(node)) return;
		if (nodeTabIndex === 0) regularTabNodes.push(node);
		else orderedTabNodes.push({
			documentOrder: i,
			tabIndex: nodeTabIndex,
			node
		});
	});
	return orderedTabNodes.sort((a, b) => a.tabIndex === b.tabIndex ? a.documentOrder - b.documentOrder : a.tabIndex - b.tabIndex).map((a) => a.node).concat(regularTabNodes);
}
function defaultIsEnabled() {
	return true;
}
/**
* @ignore - internal component.
*/
function FocusTrap(props) {
	const { children, disableAutoFocus = false, disableEnforceFocus = false, disableRestoreFocus = false, getTabbable = defaultGetTabbable, isEnabled = defaultIsEnabled, open } = props;
	const ignoreNextEnforceFocus = import_react.useRef(false);
	const sentinelStart = import_react.useRef(null);
	const sentinelEnd = import_react.useRef(null);
	const nodeToRestore = import_react.useRef(null);
	const reactFocusEventTarget = import_react.useRef(null);
	const activated = import_react.useRef(false);
	const rootRef = import_react.useRef(null);
	const handleRef = useForkRef(getReactElementRef(children), rootRef);
	const lastKeydown = import_react.useRef(null);
	import_react.useEffect(() => {
		if (!open || !rootRef.current) return;
		activated.current = !disableAutoFocus;
	}, [disableAutoFocus, open]);
	import_react.useEffect(() => {
		ignoreNextEnforceFocus.current = false;
		if (!open || !rootRef.current) return;
		const activeElement = getActiveElement_default(ownerDocument(rootRef.current));
		const focusTarget = getFocusTarget(rootRef.current) ?? rootRef.current;
		if (!contains_default(rootRef.current, activeElement)) {
			if (!focusTarget.hasAttribute("tabIndex")) {
				console.error(["MUI: The modal content node does not accept focus.", "For the benefit of assistive technologies, the tabIndex of the node is being set to \"-1\"."].join("\n"));
				focusTarget.setAttribute("tabIndex", "-1");
			}
			if (activated.current) focusTarget.focus();
		}
		return () => {
			if (!disableRestoreFocus && nodeToRestore.current) {
				ignoreNextEnforceFocus.current = true;
				nodeToRestore.current.focus();
				nodeToRestore.current = null;
			}
		};
	}, [open]);
	import_react.useEffect(() => {
		if (!open || !rootRef.current) return;
		const doc = ownerDocument(rootRef.current);
		const loopFocus = (nativeEvent) => {
			lastKeydown.current = nativeEvent;
			if (disableEnforceFocus || !isEnabled() || nativeEvent.key !== "Tab") return;
			const rootElement = rootRef.current;
			const activeElement = getActiveElement_default(doc);
			if (rootElement === null) return;
			const focusTarget = getFocusTarget(rootElement);
			if (activeElement === rootElement || activeElement === focusTarget) {
				const tabbable = getTabbable(rootElement);
				if (tabbable.length === 0) return;
				nativeEvent.preventDefault();
				if (nativeEvent.shiftKey) tabbable[tabbable.length - 1].focus();
				else tabbable[0].focus();
				return;
			}
			if (contains_default(rootElement, activeElement)) {
				const tabbable = getTabbable(rootElement);
				const currentIndex = tabbable.indexOf(activeElement);
				if (currentIndex === -1) return;
				if (!tabbable.some((node) => getTabIndex(node) > 0)) return;
				nativeEvent.preventDefault();
				let nextIndex = 0;
				if (nativeEvent.shiftKey) nextIndex = currentIndex <= 0 ? tabbable.length - 1 : currentIndex - 1;
				else nextIndex = currentIndex === tabbable.length - 1 ? 0 : currentIndex + 1;
				tabbable[nextIndex].focus();
			}
		};
		const contain = () => {
			const rootElement = rootRef.current;
			if (rootElement === null) return;
			const activeEl = getActiveElement_default(doc);
			if (!doc.hasFocus() || !isEnabled() || ignoreNextEnforceFocus.current) {
				ignoreNextEnforceFocus.current = false;
				return;
			}
			if (contains_default(rootElement, activeEl)) return;
			if (disableEnforceFocus && activeEl !== sentinelStart.current && activeEl !== sentinelEnd.current) return;
			if (activeEl !== reactFocusEventTarget.current) reactFocusEventTarget.current = null;
			else if (reactFocusEventTarget.current !== null) return;
			if (!activated.current) return;
			let tabbable = [];
			if (activeEl === sentinelStart.current || activeEl === sentinelEnd.current) tabbable = getTabbable(rootRef.current);
			if (tabbable.length > 0) {
				const isShiftTab = Boolean(lastKeydown.current?.shiftKey && lastKeydown.current?.key === "Tab");
				const focusNext = tabbable[0];
				const focusPrevious = tabbable[tabbable.length - 1];
				if (typeof focusNext !== "string" && typeof focusPrevious !== "string") if (isShiftTab) focusPrevious.focus();
				else focusNext.focus();
			} else rootElement.focus();
		};
		doc.addEventListener("focusin", contain);
		doc.addEventListener("keydown", loopFocus, true);
		const interval = setInterval(() => {
			const activeEl = getActiveElement_default(doc);
			if (activeEl && activeEl.tagName === "BODY") contain();
		}, 50);
		return () => {
			clearInterval(interval);
			doc.removeEventListener("focusin", contain);
			doc.removeEventListener("keydown", loopFocus, true);
		};
	}, [
		disableAutoFocus,
		disableEnforceFocus,
		disableRestoreFocus,
		isEnabled,
		open,
		getTabbable
	]);
	const onFocus = (event) => {
		if (nodeToRestore.current === null) nodeToRestore.current = event.relatedTarget;
		activated.current = true;
		reactFocusEventTarget.current = event.target;
		const childrenPropsHandler = children.props.onFocus;
		if (childrenPropsHandler) childrenPropsHandler(event);
	};
	const handleFocusSentinel = (event) => {
		if (nodeToRestore.current === null) nodeToRestore.current = event.relatedTarget;
		activated.current = true;
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			tabIndex: open ? 0 : -1,
			onFocus: handleFocusSentinel,
			ref: sentinelStart,
			"data-testid": "sentinelStart"
		}),
		/* @__PURE__ */ import_react.cloneElement(children, {
			ref: handleRef,
			onFocus
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			tabIndex: open ? 0 : -1,
			onFocus: handleFocusSentinel,
			ref: sentinelEnd,
			"data-testid": "sentinelEnd"
		})
	] });
}
FocusTrap.propTypes = {
	children: elementAcceptingRef,
	disableAutoFocus: import_prop_types.default.bool,
	disableEnforceFocus: import_prop_types.default.bool,
	disableRestoreFocus: import_prop_types.default.bool,
	getTabbable: import_prop_types.default.func,
	isEnabled: import_prop_types.default.func,
	open: import_prop_types.default.bool.isRequired
};
FocusTrap["propTypes"] = exactProp(FocusTrap.propTypes);
//#endregion
//#region frontend/node_modules/@mui/material/Modal/useModal.mjs
function getContainer(container) {
	return typeof container === "function" ? container() : container;
}
function getHasTransition(children) {
	return children ? children.props.hasOwnProperty("in") : false;
}
var noop = () => {};
var manager = new ModalManager();
function useModal(parameters) {
	const { container, disableScrollLock = false, closeAfterTransition = false, onTransitionEnter, onTransitionExited, children, onClose, open, rootRef } = parameters;
	const modal = import_react.useRef({});
	const mountNodeRef = import_react.useRef(null);
	const modalRef = import_react.useRef(null);
	const handleRef = useForkRef(modalRef, rootRef);
	const [exited, setExited] = import_react.useState(!open);
	const hasTransition = getHasTransition(children);
	let ariaHiddenProp = true;
	if (parameters["aria-hidden"] === "false" || parameters["aria-hidden"] === false) ariaHiddenProp = false;
	const getDoc = () => ownerDocument(mountNodeRef.current);
	const getModal = () => {
		modal.current.modalRef = modalRef.current;
		modal.current.mount = mountNodeRef.current;
		return modal.current;
	};
	const handleMounted = () => {
		manager.mount(getModal(), { disableScrollLock });
		if (modalRef.current) modalRef.current.scrollTop = 0;
	};
	const handleOpen = useEventCallback(() => {
		const resolvedContainer = getContainer(container) || getDoc().body;
		manager.add(getModal(), resolvedContainer);
		if (modalRef.current) handleMounted();
	});
	const isTopModal = () => manager.isTopModal(getModal());
	const handlePortalRef = useEventCallback((node) => {
		mountNodeRef.current = node;
		if (!node) return;
		if (open && isTopModal()) handleMounted();
		else if (modalRef.current) ariaHidden(modalRef.current, ariaHiddenProp);
	});
	const handleClose = import_react.useCallback(() => {
		manager.remove(getModal(), ariaHiddenProp);
	}, [ariaHiddenProp]);
	import_react.useEffect(() => {
		return () => {
			handleClose();
		};
	}, [handleClose]);
	import_react.useEffect(() => {
		if (open) handleOpen();
		else if (!hasTransition || !closeAfterTransition) handleClose();
	}, [
		open,
		handleClose,
		hasTransition,
		closeAfterTransition,
		handleOpen
	]);
	const createHandleKeyDown = (otherHandlers) => (event) => {
		otherHandlers.onKeyDown?.(event);
		if (event.key !== "Escape" || event.which === 229 || !isTopModal()) return;
		event.stopPropagation();
		if (onClose) onClose(event, "escapeKeyDown");
	};
	const createHandleBackdropClick = (otherHandlers) => (event) => {
		otherHandlers.onClick?.(event);
		if (event.target !== event.currentTarget) return;
		if (onClose) onClose(event, "backdropClick");
	};
	const getRootProps = (otherHandlers = {}) => {
		const propsEventHandlers = extractEventHandlers(parameters);
		delete propsEventHandlers.onTransitionEnter;
		delete propsEventHandlers.onTransitionExited;
		const externalEventHandlers = {
			...propsEventHandlers,
			...otherHandlers
		};
		return {
			role: "presentation",
			...externalEventHandlers,
			onKeyDown: createHandleKeyDown(externalEventHandlers),
			ref: handleRef
		};
	};
	const getBackdropProps = (otherHandlers = {}) => {
		const externalEventHandlers = otherHandlers;
		return {
			"aria-hidden": true,
			...externalEventHandlers,
			onClick: createHandleBackdropClick(externalEventHandlers),
			open
		};
	};
	const getTransitionProps = () => {
		const handleEnter = () => {
			setExited(false);
			if (onTransitionEnter) onTransitionEnter();
		};
		const handleExited = () => {
			setExited(true);
			if (onTransitionExited) onTransitionExited();
			if (closeAfterTransition) handleClose();
		};
		return {
			onEnter: createChainedFunction(handleEnter, children?.props.onEnter ?? noop),
			onExited: createChainedFunction(handleExited, children?.props.onExited ?? noop)
		};
	};
	return {
		getRootProps,
		getBackdropProps,
		getTransitionProps,
		rootRef: handleRef,
		portalRef: handlePortalRef,
		isTopModal,
		exited,
		hasTransition
	};
}
//#endregion
//#region frontend/node_modules/@mui/material/Modal/modalClasses.mjs
function getModalUtilityClass(slot) {
	return generateUtilityClass("MuiModal", slot);
}
var modalClasses = generateUtilityClasses("MuiModal", [
	"root",
	"hidden",
	"backdrop"
]);
//#endregion
//#region frontend/node_modules/@mui/material/Modal/Modal.mjs
var useUtilityClasses$14 = (ownerState) => {
	const { open, exited, classes } = ownerState;
	return composeClasses({
		root: ["root", !open && exited && "hidden"],
		backdrop: ["backdrop"]
	}, getModalUtilityClass, classes);
};
var ModalRoot = styled("div", {
	name: "MuiModal",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [styles.root, !ownerState.open && ownerState.exited && styles.hidden];
	}
})(memoTheme(({ theme }) => ({
	position: "fixed",
	zIndex: (theme.vars || theme).zIndex.modal,
	right: 0,
	bottom: 0,
	top: 0,
	left: 0,
	variants: [{
		props: ({ ownerState }) => !ownerState.open && ownerState.exited,
		style: { visibility: "hidden" }
	}]
})));
var ModalBackdrop = styled(Backdrop, {
	name: "MuiModal",
	slot: "Backdrop"
})({ zIndex: -1 });
/**
* Modal is a lower-level construct that is leveraged by the following components:
*
* - [Dialog](/material-ui/api/dialog/)
* - [Drawer](/material-ui/api/drawer/)
* - [Menu](/material-ui/api/menu/)
* - [Popover](/material-ui/api/popover/)
*
* If you are creating a modal dialog, you probably want to use the [Dialog](/material-ui/api/dialog/) component
* rather than directly using Modal.
*
* This component shares many concepts with [react-overlays](https://react-bootstrap.github.io/react-overlays/#modals).
*/
var Modal = /* @__PURE__ */ import_react.forwardRef(function Modal(inProps, ref) {
	const props = useDefaultProps({
		name: "MuiModal",
		props: inProps
	});
	const { classes: classesProp, className, closeAfterTransition = false, children, container, component, disableAutoFocus = false, disableEnforceFocus = false, disablePortal = false, disableRestoreFocus = false, disableScrollLock = false, hideBackdrop = false, keepMounted = false, onClose, onTransitionEnter, onTransitionExited, open, slotProps = {}, slots = {}, theme, ...other } = props;
	const propsWithDefaults = {
		...props,
		closeAfterTransition,
		disableAutoFocus,
		disableEnforceFocus,
		disablePortal,
		disableRestoreFocus,
		disableScrollLock,
		hideBackdrop,
		keepMounted
	};
	const { getRootProps, getBackdropProps, getTransitionProps, portalRef, isTopModal, exited, hasTransition } = useModal({
		...propsWithDefaults,
		rootRef: ref
	});
	const ownerState = {
		...propsWithDefaults,
		exited
	};
	const classes = useUtilityClasses$14(ownerState);
	const childProps = {};
	if (children.props.tabIndex === void 0) childProps.tabIndex = "-1";
	if (hasTransition) {
		const { onEnter, onExited } = getTransitionProps();
		childProps.onEnter = onEnter;
		childProps.onExited = onExited;
	}
	const externalForwardedProps = {
		slots,
		slotProps
	};
	const [RootSlot, rootProps] = useSlot("root", {
		ref,
		elementType: ModalRoot,
		externalForwardedProps: {
			...externalForwardedProps,
			...other,
			component
		},
		getSlotProps: getRootProps,
		ownerState,
		className: clsx(className, classes?.root, !ownerState.open && ownerState.exited && classes?.hidden)
	});
	const [BackdropSlot, backdropProps] = useSlot("backdrop", {
		elementType: ModalBackdrop,
		externalForwardedProps,
		shouldForwardComponentProp: true,
		getSlotProps: (otherHandlers) => {
			return getBackdropProps({
				...otherHandlers,
				onClick: (event) => {
					if (otherHandlers?.onClick) otherHandlers.onClick(event);
				}
			});
		},
		className: classes?.backdrop,
		ownerState
	});
	if (!keepMounted && !open && (!hasTransition || exited)) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Portal, {
		ref: portalRef,
		container,
		disablePortal,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(RootSlot, {
			...rootProps,
			children: [!hideBackdrop ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BackdropSlot, { ...backdropProps }) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FocusTrap, {
				disableEnforceFocus,
				disableAutoFocus,
				disableRestoreFocus,
				isEnabled: isTopModal,
				open,
				children: /* @__PURE__ */ import_react.cloneElement(children, childProps)
			})]
		})
	});
});
Modal.propTypes = {
	children: elementAcceptingRef.isRequired,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	closeAfterTransition: import_prop_types.default.bool,
	component: import_prop_types.default.elementType,
	container: import_prop_types.default.oneOfType([HTMLElementType, import_prop_types.default.func]),
	disableAutoFocus: import_prop_types.default.bool,
	disableEnforceFocus: import_prop_types.default.bool,
	disablePortal: import_prop_types.default.bool,
	disableRestoreFocus: import_prop_types.default.bool,
	disableScrollLock: import_prop_types.default.bool,
	hideBackdrop: import_prop_types.default.bool,
	keepMounted: import_prop_types.default.bool,
	onClose: import_prop_types.default.func,
	onTransitionEnter: import_prop_types.default.func,
	onTransitionExited: import_prop_types.default.func,
	open: import_prop_types.default.bool.isRequired,
	slotProps: import_prop_types.default.shape({
		backdrop: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		backdrop: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType
	}),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/FilledInput/FilledInput.mjs
var useUtilityClasses$13 = (ownerState) => {
	const { classes, disableUnderline, startAdornment, endAdornment, size, hiddenLabel, multiline } = ownerState;
	const composedClasses = composeClasses({
		root: [
			"root",
			!disableUnderline && "underline",
			startAdornment && "adornedStart",
			endAdornment && "adornedEnd",
			size === "small" && `size${capitalize_default(size)}`,
			hiddenLabel && "hiddenLabel",
			multiline && "multiline"
		],
		input: ["input"]
	}, getFilledInputUtilityClass, classes);
	return {
		...classes,
		...composedClasses
	};
};
var FilledInputRoot = styled(InputBaseRoot, {
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) || prop === "classes",
	name: "MuiFilledInput",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [...rootOverridesResolver(props, styles), !ownerState.disableUnderline && styles.underline];
	}
})(memoTheme(({ theme }) => {
	const light = theme.palette.mode === "light";
	const bottomLineColor = light ? "rgba(0, 0, 0, 0.42)" : "rgba(255, 255, 255, 0.7)";
	const backgroundColor = light ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.09)";
	const hoverBackground = light ? "rgba(0, 0, 0, 0.09)" : "rgba(255, 255, 255, 0.13)";
	const disabledBackground = light ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.12)";
	return {
		position: "relative",
		backgroundColor: theme.vars ? theme.vars.palette.FilledInput.bg : backgroundColor,
		borderTopLeftRadius: (theme.vars || theme).shape.borderRadius,
		borderTopRightRadius: (theme.vars || theme).shape.borderRadius,
		...getTransitionStyles(theme, "background-color", {
			duration: theme.transitions.duration.shorter,
			easing: theme.transitions.easing.easeOut
		}),
		"&:hover": {
			backgroundColor: theme.vars ? theme.vars.palette.FilledInput.hoverBg : hoverBackground,
			"@media (hover: none)": { backgroundColor: theme.vars ? theme.vars.palette.FilledInput.bg : backgroundColor }
		},
		[`&.${filledInputClasses.focused}`]: { backgroundColor: theme.vars ? theme.vars.palette.FilledInput.bg : backgroundColor },
		[`&.${filledInputClasses.disabled}`]: { backgroundColor: theme.vars ? theme.vars.palette.FilledInput.disabledBg : disabledBackground },
		variants: [
			{
				props: ({ ownerState }) => !ownerState.disableUnderline,
				style: {
					"&::after": {
						left: 0,
						bottom: 0,
						content: "\"\"",
						position: "absolute",
						right: 0,
						transform: "scaleX(0)",
						...getTransitionStyles(theme, "transform", {
							duration: theme.transitions.duration.shorter,
							easing: theme.transitions.easing.easeOut
						}),
						pointerEvents: "none"
					},
					[`&.${filledInputClasses.focused}:after`]: { transform: "scaleX(1) translateX(0)" },
					[`&.${filledInputClasses.error}`]: { "&::before, &::after": { borderBottomColor: (theme.vars || theme).palette.error.main } },
					"&::before": {
						borderBottom: `1px solid ${theme.vars ? theme.alpha(theme.vars.palette.common.onBackground, theme.vars.opacity.inputUnderline) : bottomLineColor}`,
						left: 0,
						bottom: 0,
						content: "\"\"",
						position: "absolute",
						right: 0,
						...getTransitionStyles(theme, "border-bottom-color", { duration: theme.transitions.duration.shorter }),
						pointerEvents: "none"
					},
					[`&:hover:not(.${filledInputClasses.disabled}, .${filledInputClasses.error}):before`]: { borderBottom: `1px solid ${(theme.vars || theme).palette.text.primary}` },
					[`&.${filledInputClasses.disabled}:before`]: { borderBottomStyle: "dotted" }
				}
			},
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter()).map(([color]) => ({
				props: {
					disableUnderline: false,
					color
				},
				style: { "&::after": { borderBottom: `2px solid ${(theme.vars || theme).palette[color]?.main}` } }
			})),
			{
				props: ({ ownerState }) => ownerState.startAdornment,
				style: { paddingLeft: 12 }
			},
			{
				props: ({ ownerState }) => ownerState.endAdornment,
				style: { paddingRight: 12 }
			},
			{
				props: ({ ownerState }) => ownerState.multiline,
				style: { padding: "25px 12px 8px" }
			},
			{
				props: ({ ownerState, size }) => ownerState.multiline && size === "small",
				style: {
					paddingTop: 21,
					paddingBottom: 4
				}
			},
			{
				props: ({ ownerState }) => ownerState.multiline && ownerState.hiddenLabel,
				style: {
					paddingTop: 16,
					paddingBottom: 17
				}
			},
			{
				props: ({ ownerState }) => ownerState.multiline && ownerState.hiddenLabel && ownerState.size === "small",
				style: {
					paddingTop: 8,
					paddingBottom: 9
				}
			}
		]
	};
}));
var FilledInputInput = styled(InputBaseInput, {
	name: "MuiFilledInput",
	slot: "Input",
	overridesResolver: inputOverridesResolver
})(memoTheme(({ theme }) => ({
	paddingTop: 25,
	paddingRight: 12,
	paddingBottom: 8,
	paddingLeft: 12,
	"&:-webkit-autofill": {
		...!theme.vars && {
			WebkitBoxShadow: theme.palette.mode === "light" ? null : "0 0 0 100px #266798 inset",
			WebkitTextFillColor: theme.palette.mode === "light" ? null : "#fff",
			caretColor: theme.palette.mode === "light" ? null : "#fff"
		},
		borderTopLeftRadius: "inherit",
		borderTopRightRadius: "inherit",
		...theme.vars && theme.applyStyles("dark", {
			WebkitBoxShadow: "0 0 0 100px #266798 inset",
			WebkitTextFillColor: "#fff",
			caretColor: "#fff"
		})
	},
	variants: [
		{
			props: { size: "small" },
			style: {
				paddingTop: 21,
				paddingBottom: 4
			}
		},
		{
			props: ({ ownerState }) => ownerState.hiddenLabel,
			style: {
				paddingTop: 16,
				paddingBottom: 17
			}
		},
		{
			props: ({ ownerState }) => ownerState.startAdornment,
			style: { paddingLeft: 0 }
		},
		{
			props: ({ ownerState }) => ownerState.endAdornment,
			style: { paddingRight: 0 }
		},
		{
			props: ({ ownerState }) => ownerState.hiddenLabel && ownerState.size === "small",
			style: {
				paddingTop: 8,
				paddingBottom: 9
			}
		},
		{
			props: ({ ownerState }) => ownerState.multiline,
			style: {
				paddingTop: 0,
				paddingBottom: 0,
				paddingLeft: 0,
				paddingRight: 0
			}
		}
	]
})));
var FilledInput = /* @__PURE__ */ import_react.forwardRef(function FilledInput(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiFilledInput"
	});
	const { disableUnderline = false, fullWidth = false, hiddenLabel, inputComponent = "input", multiline = false, notched, slotProps, slots = {}, type = "text", ...other } = props;
	const ownerState = {
		...props,
		disableUnderline,
		fullWidth,
		inputComponent,
		multiline,
		type
	};
	const classes = useUtilityClasses$13(props);
	const filledInputComponentsProps = {
		root: { ownerState },
		input: { ownerState }
	};
	const componentsProps = slotProps ? deepmerge(filledInputComponentsProps, slotProps) : filledInputComponentsProps;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputBase, {
		slots: {
			root: slots.root ?? FilledInputRoot,
			input: slots.input ?? FilledInputInput
		},
		slotProps: componentsProps,
		fullWidth,
		inputComponent,
		multiline,
		ref,
		type,
		...other,
		classes
	});
});
FilledInput.propTypes = {
	autoComplete: import_prop_types.default.string,
	autoFocus: import_prop_types.default.bool,
	classes: import_prop_types.default.object,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["primary", "secondary"]), import_prop_types.default.string]),
	defaultValue: import_prop_types.default.any,
	disabled: import_prop_types.default.bool,
	disableUnderline: import_prop_types.default.bool,
	endAdornment: import_prop_types.default.node,
	error: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	hiddenLabel: import_prop_types.default.bool,
	id: import_prop_types.default.string,
	inputComponent: import_prop_types.default.elementType,
	inputProps: import_prop_types.default.object,
	inputRef: refType,
	margin: import_prop_types.default.oneOf(["dense", "none"]),
	maxRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	minRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	multiline: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	notched: import_prop_types.default.bool,
	onChange: import_prop_types.default.func,
	placeholder: import_prop_types.default.string,
	readOnly: import_prop_types.default.bool,
	required: import_prop_types.default.bool,
	rows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	slotProps: import_prop_types.default.shape({
		input: import_prop_types.default.object,
		root: import_prop_types.default.object
	}),
	slots: import_prop_types.default.shape({
		input: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType
	}),
	startAdornment: import_prop_types.default.node,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	type: import_prop_types.default.string,
	value: import_prop_types.default.any
};
FilledInput.muiName = "Input";
//#endregion
//#region frontend/node_modules/@mui/material/FormControl/formControlClasses.mjs
function getFormControlUtilityClasses(slot) {
	return generateUtilityClass("MuiFormControl", slot);
}
var formControlClasses = generateUtilityClasses("MuiFormControl", [
	"root",
	"marginNone",
	"marginNormal",
	"marginDense",
	"fullWidth",
	"disabled"
]);
//#endregion
//#region frontend/node_modules/@mui/material/FormControl/FormControl.mjs
var useUtilityClasses$12 = (ownerState) => {
	const { classes, margin, fullWidth } = ownerState;
	return composeClasses({ root: [
		"root",
		margin !== "none" && `margin${capitalize_default(margin)}`,
		fullWidth && "fullWidth"
	] }, getFormControlUtilityClasses, classes);
};
var FormControlRoot = styled("div", {
	name: "MuiFormControl",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.root,
			styles[`margin${capitalize_default(ownerState.margin)}`],
			ownerState.fullWidth && styles.fullWidth
		];
	}
})({
	display: "inline-flex",
	flexDirection: "column",
	position: "relative",
	minWidth: 0,
	padding: 0,
	margin: 0,
	border: 0,
	verticalAlign: "top",
	variants: [
		{
			props: { margin: "normal" },
			style: {
				marginTop: 16,
				marginBottom: 8
			}
		},
		{
			props: { margin: "dense" },
			style: {
				marginTop: 8,
				marginBottom: 4
			}
		},
		{
			props: { fullWidth: true },
			style: { width: "100%" }
		}
	]
});
/**
* Provides context such as filled/focused/error/required for form inputs.
* Relying on the context provides high flexibility and ensures that the state always stays
* consistent across the children of the `FormControl`.
* This context is used by the following components:
*
*  - FormLabel
*  - FormHelperText
*  - Input
*  - InputLabel
*
* You can find one composition example below and more going to [the demos](/material-ui/react-text-field/#components).
*
* ```jsx
* <FormControl>
*   <InputLabel htmlFor="my-input">Email address</InputLabel>
*   <Input id="my-input" aria-describedby="my-helper-text" />
*   <FormHelperText id="my-helper-text">We'll never share your email.</FormHelperText>
* </FormControl>
* ```
*
* ⚠️ Only one `InputBase` can be used within a FormControl because it creates visual inconsistencies.
* For instance, only one input can be focused at the same time, the state shouldn't be shared.
*/
var FormControl = /* @__PURE__ */ import_react.forwardRef(function FormControl(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiFormControl"
	});
	const { children, className, color = "primary", component = "div", disabled = false, error = false, focused: visuallyFocused, fullWidth = false, hiddenLabel = false, margin = "none", required = false, size = "medium", variant = "outlined", ...other } = props;
	const ownerState = {
		...props,
		color,
		component,
		disabled,
		error,
		fullWidth,
		hiddenLabel,
		margin,
		required,
		size,
		variant
	};
	const classes = useUtilityClasses$12(ownerState);
	const [adornedStart, setAdornedStart] = import_react.useState(() => {
		let initialAdornedStart = false;
		if (children) import_react.Children.forEach(children, (child) => {
			if (!isMuiElement_default(child, ["Input", "Select"])) return;
			const input = isMuiElement_default(child, ["Select"]) ? child.props.input : child;
			if (input && isAdornedStart(input.props)) initialAdornedStart = true;
		});
		return initialAdornedStart;
	});
	const [filled, setFilled] = import_react.useState(() => {
		let initialFilled = false;
		if (children) import_react.Children.forEach(children, (child) => {
			if (!isMuiElement_default(child, ["Input", "Select"])) return;
			if (isFilled(child.props, true) || isFilled(child.props.inputProps, true)) initialFilled = true;
		});
		return initialFilled;
	});
	const [focusedState, setFocused] = import_react.useState(false);
	if (disabled && focusedState) setFocused(false);
	const focused = visuallyFocused !== void 0 && !disabled ? visuallyFocused : focusedState;
	let registerEffect;
	const registeredInput = import_react.useRef(false);
	registerEffect = () => {
		if (registeredInput.current) console.error(["MUI: There are multiple `InputBase` components inside a FormControl.", "This creates visual inconsistencies, only use one `InputBase`."].join("\n"));
		registeredInput.current = true;
		return () => {
			registeredInput.current = false;
		};
	};
	const onFilled = import_react.useCallback(() => {
		setFilled(true);
	}, []);
	const onEmpty = import_react.useCallback(() => {
		setFilled(false);
	}, []);
	const childContext = import_react.useMemo(() => {
		return {
			adornedStart,
			setAdornedStart,
			color,
			disabled,
			error,
			filled,
			focused,
			fullWidth,
			hiddenLabel,
			size,
			onBlur: () => {
				setFocused(false);
			},
			onFocus: () => {
				setFocused(true);
			},
			onEmpty,
			onFilled,
			registerEffect,
			required,
			variant
		};
	}, [
		adornedStart,
		color,
		disabled,
		error,
		filled,
		focused,
		fullWidth,
		hiddenLabel,
		registerEffect,
		onEmpty,
		onFilled,
		required,
		size,
		variant
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormControlContext.Provider, {
		value: childContext,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormControlRoot, {
			as: component,
			ownerState,
			className: clsx(classes.root, className),
			ref,
			...other,
			children
		})
	});
});
FormControl.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"primary",
		"secondary",
		"error",
		"info",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	component: import_prop_types.default.elementType,
	disabled: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	focused: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	hiddenLabel: import_prop_types.default.bool,
	margin: import_prop_types.default.oneOf([
		"dense",
		"none",
		"normal"
	]),
	required: import_prop_types.default.bool,
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["medium", "small"]), import_prop_types.default.string]),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	variant: import_prop_types.default.oneOf([
		"filled",
		"outlined",
		"standard"
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/FormHelperText/FormHelperText.mjs
var _span$2;
var useUtilityClasses$11 = (ownerState) => {
	const { classes, contained, size, disabled, error, filled, focused, required } = ownerState;
	return composeClasses({ root: [
		"root",
		disabled && "disabled",
		error && "error",
		size && `size${capitalize_default(size)}`,
		contained && "contained",
		focused && "focused",
		filled && "filled",
		required && "required"
	] }, getFormHelperTextUtilityClasses, classes);
};
var FormHelperTextRoot = styled("p", {
	name: "MuiFormHelperText",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.root,
			ownerState.size && styles[`size${capitalize_default(ownerState.size)}`],
			ownerState.contained && styles.contained,
			ownerState.filled && styles.filled
		];
	}
})(memoTheme(({ theme }) => ({
	color: (theme.vars || theme).palette.text.secondary,
	...theme.typography.caption,
	textAlign: "left",
	marginTop: 3,
	marginRight: 0,
	marginBottom: 0,
	marginLeft: 0,
	[`&.${formHelperTextClasses.disabled}`]: { color: (theme.vars || theme).palette.text.disabled },
	[`&.${formHelperTextClasses.error}`]: { color: (theme.vars || theme).palette.error.main },
	variants: [{
		props: { size: "small" },
		style: { marginTop: 4 }
	}, {
		props: ({ ownerState }) => ownerState.contained,
		style: {
			marginLeft: 14,
			marginRight: 14
		}
	}]
})));
var FormHelperText = /* @__PURE__ */ import_react.forwardRef(function FormHelperText(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiFormHelperText"
	});
	const { children, className, component = "p", disabled, error, filled, focused, margin, required, variant, ...other } = props;
	const [fcs] = useFormControlState({
		props,
		states: [
			"variant",
			"size",
			"disabled",
			"error",
			"filled",
			"focused",
			"required"
		]
	});
	const ownerState = {
		...props,
		component,
		contained: fcs.variant === "filled" || fcs.variant === "outlined",
		variant: fcs.variant,
		size: fcs.size,
		disabled: fcs.disabled,
		error: fcs.error,
		filled: fcs.filled,
		focused: fcs.focused,
		required: fcs.required
	};
	delete ownerState.ownerState;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormHelperTextRoot, {
		as: component,
		className: clsx(useUtilityClasses$11(ownerState).root, className),
		ref,
		...other,
		ownerState,
		children: children === " " ? _span$2 || (_span$2 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "notranslate",
			"aria-hidden": true,
			children: "​"
		})) : children
	});
});
FormHelperText.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	component: import_prop_types.default.elementType,
	disabled: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	filled: import_prop_types.default.bool,
	focused: import_prop_types.default.bool,
	margin: import_prop_types.default.oneOf(["dense"]),
	required: import_prop_types.default.bool,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	variant: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"filled",
		"outlined",
		"standard"
	]), import_prop_types.default.string])
};
//#endregion
//#region frontend/node_modules/@mui/material/FormLabel/FormLabel.mjs
var useUtilityClasses$10 = (ownerState) => {
	const { classes, color, focused, disabled, error, filled, required } = ownerState;
	return composeClasses({
		root: [
			"root",
			`color${capitalize_default(color)}`,
			disabled && "disabled",
			error && "error",
			filled && "filled",
			focused && "focused",
			required && "required"
		],
		asterisk: ["asterisk", error && "error"]
	}, getFormLabelUtilityClasses, classes);
};
var FormLabelRoot = styled("label", {
	name: "MuiFormLabel",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.root,
			ownerState.color === "secondary" && styles.colorSecondary,
			ownerState.filled && styles.filled
		];
	}
})(memoTheme(({ theme }) => ({
	color: (theme.vars || theme).palette.text.secondary,
	...theme.typography.body1,
	lineHeight: "1.4375em",
	padding: 0,
	position: "relative",
	variants: [...Object.entries(theme.palette).filter(createSimplePaletteValueFilter()).map(([color]) => ({
		props: { color },
		style: { [`&.${formLabelClasses.focused}`]: { color: (theme.vars || theme).palette[color].main } }
	})), {
		props: {},
		style: {
			[`&.${formLabelClasses.disabled}`]: { color: (theme.vars || theme).palette.text.disabled },
			[`&.${formLabelClasses.error}`]: { color: (theme.vars || theme).palette.error.main }
		}
	}]
})));
var AsteriskComponent = styled("span", {
	name: "MuiFormLabel",
	slot: "Asterisk"
})(memoTheme(({ theme }) => ({ [`&.${formLabelClasses.error}`]: { color: (theme.vars || theme).palette.error.main } })));
var FormLabel = /* @__PURE__ */ import_react.forwardRef(function FormLabel(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiFormLabel"
	});
	const { children, className, color, component = "label", disabled, error, filled, focused, required, ...other } = props;
	const [fcs] = useFormControlState({
		props,
		states: [
			"color",
			"required",
			"focused",
			"disabled",
			"error",
			"filled"
		]
	});
	const ownerState = {
		...props,
		color: fcs.color || "primary",
		component,
		disabled: fcs.disabled,
		error: fcs.error,
		filled: fcs.filled,
		focused: fcs.focused,
		required: fcs.required
	};
	const classes = useUtilityClasses$10(ownerState);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(FormLabelRoot, {
		as: component,
		ownerState,
		className: clsx(classes.root, className),
		ref,
		...other,
		children: [children, fcs.required && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AsteriskComponent, {
			ownerState,
			"aria-hidden": true,
			className: classes.asterisk,
			children: [" ", "*"]
		})]
	});
});
FormLabel.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"error",
		"info",
		"primary",
		"secondary",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	component: import_prop_types.default.elementType,
	disabled: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	filled: import_prop_types.default.bool,
	focused: import_prop_types.default.bool,
	required: import_prop_types.default.bool,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/Grow/Grow.mjs
function getScale(value) {
	return `scale(${value}, ${value ** 2})`;
}
var styles = {
	entering: {
		opacity: 1,
		transform: getScale(1)
	},
	entered: {
		opacity: 1,
		transform: "none"
	},
	exiting: {
		opacity: 0,
		transform: getScale(.75)
	},
	exited: {
		opacity: 0,
		transform: getScale(.75)
	}
};
var hiddenStyles = {
	opacity: 0,
	transform: getScale(.75),
	visibility: "hidden"
};
/**
* The Grow transition is used by the [Tooltip](/material-ui/react-tooltip/) and
* [Popover](/material-ui/react-popover/) components.
*/
var Grow = /* @__PURE__ */ import_react.forwardRef(function Grow(props, ref) {
	const { addEndListener, appear = true, children, disablePrefersReducedMotion = false, easing, in: inProp, onEnter, onEntered, onEntering, onExit, onExited, onExiting, style, timeout = "auto", ...other } = props;
	const autoTimeout = import_react.useRef(null);
	const theme = useTheme();
	const reducedMotion = useReducedMotion(theme.motion.reducedMotion, disablePrefersReducedMotion);
	const nodeRef = import_react.useRef(null);
	const handleRef = useForkRef_default(nodeRef, getReactElementRef(children), ref);
	const handleEntering = normalizedTransitionCallback(nodeRef, onEntering);
	const handleEnter = normalizedTransitionCallback(nodeRef, (node, isAppearing) => {
		if (!reducedMotion.shouldReduceMotion) reflow(node);
		const { duration: transitionDuration, delay, easing: transitionTimingFunction } = getTransitionProps({
			style,
			timeout,
			easing
		}, { mode: "enter" });
		let duration;
		if (timeout === "auto" && !reducedMotion.shouldReduceMotion) {
			duration = theme.transitions.getAutoHeightDuration(node.clientHeight);
			autoTimeout.current = duration;
		} else {
			duration = transitionDuration;
			autoTimeout.current = null;
		}
		const transitionTiming = reducedMotion.getTransitionTiming({
			duration,
			delay
		});
		node.style.transition = [theme.transitions.create("opacity", {
			duration: transitionTiming.duration,
			delay: transitionTiming.delay
		}), theme.transitions.create("transform", {
			duration: typeof transitionTiming.duration === "string" ? transitionTiming.duration : transitionTiming.duration * .666,
			delay: transitionTiming.delay,
			easing: transitionTimingFunction
		})].join(",");
		if (onEnter) onEnter(node, isAppearing);
	});
	const handleEntered = normalizedTransitionCallback(nodeRef, onEntered);
	const handleExiting = normalizedTransitionCallback(nodeRef, onExiting);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Transition, {
		appear,
		in: inProp,
		nodeRef,
		onEnter: handleEnter,
		onEntered: handleEntered,
		onEntering: handleEntering,
		onExit: normalizedTransitionCallback(nodeRef, (node) => {
			const { duration: transitionDuration, delay, easing: transitionTimingFunction } = getTransitionProps({
				style,
				timeout,
				easing
			}, { mode: "exit" });
			let duration;
			if (timeout === "auto" && !reducedMotion.shouldReduceMotion) {
				duration = theme.transitions.getAutoHeightDuration(node.clientHeight);
				autoTimeout.current = duration;
			} else {
				duration = transitionDuration;
				autoTimeout.current = null;
			}
			const transitionTiming = reducedMotion.getTransitionTiming({
				duration,
				delay
			});
			node.style.transition = [theme.transitions.create("opacity", {
				duration: transitionTiming.duration,
				delay: transitionTiming.delay
			}), theme.transitions.create("transform", {
				duration: typeof transitionTiming.duration === "string" ? transitionTiming.duration : transitionTiming.duration * .666,
				delay: transitionTiming.delay || (typeof transitionTiming.duration === "string" ? transitionTiming.duration : transitionTiming.duration * .333),
				easing: transitionTimingFunction
			})].join(",");
			node.style.opacity = 0;
			node.style.transform = getScale(.75);
			if (onExit) onExit(node);
		}),
		onExited: normalizedTransitionCallback(nodeRef, (node) => {
			node.style.transition = "";
			if (onExited) onExited(node);
		}),
		onExiting: handleExiting,
		addEndListener: addEndListener ? (next) => {
			addEndListener(nodeRef.current, next);
		} : void 0,
		getAutoTimeout: timeout === "auto" ? () => autoTimeout.current : void 0,
		reduceMotion: reducedMotion.shouldReduceMotion,
		timeout: timeout === "auto" ? null : timeout,
		...other,
		children: (state, { ownerState, ...restChildProps }) => {
			const childStyle = getTransitionChildStyle(state, inProp, styles, hiddenStyles, style, children.props.style);
			return /* @__PURE__ */ import_react.cloneElement(children, {
				style: childStyle,
				ref: handleRef,
				...restChildProps
			});
		}
	});
});
Grow.propTypes = {
	addEndListener: import_prop_types.default.func,
	appear: import_prop_types.default.bool,
	children: elementAcceptingRef.isRequired,
	disablePrefersReducedMotion: import_prop_types.default.bool,
	easing: import_prop_types.default.oneOfType([import_prop_types.default.shape({
		enter: import_prop_types.default.string,
		exit: import_prop_types.default.string
	}), import_prop_types.default.string]),
	in: import_prop_types.default.bool,
	onEnter: import_prop_types.default.func,
	onEntered: import_prop_types.default.func,
	onEntering: import_prop_types.default.func,
	onExit: import_prop_types.default.func,
	onExited: import_prop_types.default.func,
	onExiting: import_prop_types.default.func,
	style: import_prop_types.default.object,
	timeout: import_prop_types.default.oneOfType([
		import_prop_types.default.oneOf(["auto"]),
		import_prop_types.default.number,
		import_prop_types.default.shape({
			appear: import_prop_types.default.number,
			enter: import_prop_types.default.number,
			exit: import_prop_types.default.number
		})
	])
};
if (Grow) Grow.muiSupportAuto = true;
//#endregion
//#region frontend/node_modules/@mui/material/InputLabel/inputLabelClasses.mjs
function getInputLabelUtilityClasses(slot) {
	return generateUtilityClass("MuiInputLabel", slot);
}
var inputLabelClasses = generateUtilityClasses("MuiInputLabel", [
	"root",
	"focused",
	"disabled",
	"error",
	"required",
	"asterisk",
	"formControl",
	"sizeSmall",
	"shrink",
	"animated",
	"standard",
	"filled",
	"outlined"
]);
//#endregion
//#region frontend/node_modules/@mui/material/Input/Input.mjs
var useUtilityClasses$9 = (ownerState) => {
	const { classes, disableUnderline } = ownerState;
	const composedClasses = composeClasses({
		root: ["root", !disableUnderline && "underline"],
		input: ["input"]
	}, getInputUtilityClass, classes);
	return {
		...classes,
		...composedClasses
	};
};
var InputRoot = styled(InputBaseRoot, {
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) || prop === "classes",
	name: "MuiInput",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [...rootOverridesResolver(props, styles), !ownerState.disableUnderline && styles.underline];
	}
})(memoTheme(({ theme }) => {
	let bottomLineColor = theme.palette.mode === "light" ? "rgba(0, 0, 0, 0.42)" : "rgba(255, 255, 255, 0.7)";
	if (theme.vars) bottomLineColor = theme.alpha(theme.vars.palette.common.onBackground, theme.vars.opacity.inputUnderline);
	return {
		position: "relative",
		variants: [
			{
				props: ({ ownerState }) => ownerState.formControl,
				style: { [`label + &, .${inputLabelClasses.root} + &`]: { marginTop: 16 } }
			},
			{
				props: ({ ownerState }) => !ownerState.disableUnderline,
				style: {
					"&::after": {
						left: 0,
						bottom: 0,
						content: "\"\"",
						position: "absolute",
						right: 0,
						transform: "scaleX(0)",
						...getTransitionStyles(theme, "transform", {
							duration: theme.transitions.duration.shorter,
							easing: theme.transitions.easing.easeOut
						}),
						pointerEvents: "none"
					},
					[`&.${inputClasses.focused}:after`]: { transform: "scaleX(1) translateX(0)" },
					[`&.${inputClasses.error}`]: { "&::before, &::after": { borderBottomColor: (theme.vars || theme).palette.error.main } },
					"&::before": {
						borderBottom: `1px solid ${bottomLineColor}`,
						left: 0,
						bottom: 0,
						content: "\"\"",
						position: "absolute",
						right: 0,
						...getTransitionStyles(theme, "border-bottom-color", { duration: theme.transitions.duration.shorter }),
						pointerEvents: "none"
					},
					[`&:hover:not(.${inputClasses.disabled}, .${inputClasses.error}):before`]: {
						borderBottom: `2px solid ${(theme.vars || theme).palette.text.primary}`,
						"@media (hover: none)": { borderBottom: `1px solid ${bottomLineColor}` }
					},
					[`&.${inputClasses.disabled}:before`]: { borderBottomStyle: "dotted" }
				}
			},
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter()).map(([color]) => ({
				props: {
					color,
					disableUnderline: false
				},
				style: { "&::after": { borderBottom: `2px solid ${(theme.vars || theme).palette[color].main}` } }
			}))
		]
	};
}));
var InputInput = styled(InputBaseInput, {
	name: "MuiInput",
	slot: "Input",
	overridesResolver: inputOverridesResolver
})({});
var Input = /* @__PURE__ */ import_react.forwardRef(function Input(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiInput"
	});
	const { disableUnderline = false, fullWidth = false, inputComponent = "input", multiline = false, notched, slotProps, slots = {}, type = "text", ...other } = props;
	const classes = useUtilityClasses$9(props);
	const inputComponentsProps = { root: { ownerState: { disableUnderline } } };
	const componentsProps = slotProps ? deepmerge(slotProps, inputComponentsProps) : inputComponentsProps;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputBase, {
		slots: {
			root: slots.root ?? InputRoot,
			input: slots.input ?? InputInput
		},
		slotProps: componentsProps,
		fullWidth,
		inputComponent,
		multiline,
		ref,
		type,
		...other,
		classes
	});
});
Input.propTypes = {
	autoComplete: import_prop_types.default.string,
	autoFocus: import_prop_types.default.bool,
	classes: import_prop_types.default.object,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["primary", "secondary"]), import_prop_types.default.string]),
	defaultValue: import_prop_types.default.any,
	disabled: import_prop_types.default.bool,
	disableUnderline: import_prop_types.default.bool,
	endAdornment: import_prop_types.default.node,
	error: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	id: import_prop_types.default.string,
	inputComponent: import_prop_types.default.elementType,
	inputProps: import_prop_types.default.object,
	inputRef: refType,
	margin: import_prop_types.default.oneOf(["dense", "none"]),
	maxRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	minRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	multiline: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	notched: import_prop_types.default.bool,
	onChange: import_prop_types.default.func,
	placeholder: import_prop_types.default.string,
	readOnly: import_prop_types.default.bool,
	required: import_prop_types.default.bool,
	rows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	slotProps: import_prop_types.default.shape({
		input: import_prop_types.default.object,
		root: import_prop_types.default.object
	}),
	slots: import_prop_types.default.shape({
		input: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType
	}),
	startAdornment: import_prop_types.default.node,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	type: import_prop_types.default.string,
	value: import_prop_types.default.any
};
Input.muiName = "Input";
//#endregion
//#region frontend/node_modules/@mui/material/InputLabel/InputLabel.mjs
var useUtilityClasses$8 = (ownerState) => {
	const { classes, formControl, size, shrink, disableAnimation, variant, required } = ownerState;
	const composedClasses = composeClasses({
		root: [
			"root",
			formControl && "formControl",
			!disableAnimation && "animated",
			shrink && "shrink",
			size && size !== "medium" && `size${capitalize_default(size)}`,
			variant
		],
		asterisk: [required && "asterisk"]
	}, getInputLabelUtilityClasses, classes);
	return {
		...classes,
		...composedClasses
	};
};
var InputLabelRoot = styled(FormLabel, {
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) || prop === "classes",
	name: "MuiInputLabel",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			{ [`& .${formLabelClasses.asterisk}`]: styles.asterisk },
			styles.root,
			ownerState.formControl && styles.formControl,
			ownerState.size === "small" && styles.sizeSmall,
			ownerState.shrink && styles.shrink,
			!ownerState.disableAnimation && styles.animated,
			ownerState.focused && styles.focused,
			styles[ownerState.variant]
		];
	}
})(memoTheme(({ theme }) => ({
	display: "block",
	transformOrigin: "top left",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	maxWidth: "100%",
	variants: [
		{
			props: ({ ownerState }) => ownerState.formControl,
			style: {
				position: "absolute",
				left: 0,
				top: 0,
				transform: "translate(0, 20px) scale(1)"
			}
		},
		{
			props: { size: "small" },
			style: { transform: "translate(0, 17px) scale(1)" }
		},
		{
			props: ({ ownerState }) => ownerState.shrink,
			style: {
				transform: "translate(0, -1.5px) scale(0.75)",
				transformOrigin: "top left",
				maxWidth: "133%"
			}
		},
		{
			props: ({ ownerState }) => !ownerState.disableAnimation,
			style: { ...getTransitionStyles(theme, [
				"color",
				"transform",
				"max-width"
			], {
				duration: theme.transitions.duration.shorter,
				easing: theme.transitions.easing.easeOut
			}) }
		},
		{
			props: { variant: "filled" },
			style: {
				zIndex: 1,
				pointerEvents: "none",
				transform: "translate(12px, 16px) scale(1)",
				maxWidth: "calc(100% - 24px)"
			}
		},
		{
			props: {
				variant: "filled",
				size: "small"
			},
			style: { transform: "translate(12px, 13px) scale(1)" }
		},
		{
			props: ({ variant, ownerState }) => variant === "filled" && ownerState.shrink,
			style: {
				userSelect: "none",
				pointerEvents: "auto",
				transform: "translate(12px, 7px) scale(0.75)",
				maxWidth: "calc(133% - 24px)"
			}
		},
		{
			props: ({ variant, ownerState, size }) => variant === "filled" && ownerState.shrink && size === "small",
			style: { transform: "translate(12px, 4px) scale(0.75)" }
		},
		{
			props: { variant: "outlined" },
			style: {
				zIndex: 1,
				pointerEvents: "none",
				transform: "translate(14px, 16px) scale(1)",
				maxWidth: "calc(100% - 24px)"
			}
		},
		{
			props: {
				variant: "outlined",
				size: "small"
			},
			style: { transform: "translate(14px, 9px) scale(1)" }
		},
		{
			props: ({ variant, ownerState }) => variant === "outlined" && ownerState.shrink,
			style: {
				userSelect: "none",
				pointerEvents: "auto",
				maxWidth: "calc(133% - 32px)",
				transform: "translate(14px, -9px) scale(0.75)"
			}
		}
	]
})));
var InputLabel = /* @__PURE__ */ import_react.forwardRef(function InputLabel(inProps, ref) {
	const props = useDefaultProps({
		name: "MuiInputLabel",
		props: inProps
	});
	const { disableAnimation = false, margin, shrink: shrinkProp, variant, className, ...other } = props;
	const [fcs, muiFormControl] = useFormControlState({
		props,
		states: [
			"size",
			"variant",
			"required",
			"focused"
		]
	});
	let shrink = shrinkProp;
	if (typeof shrink === "undefined" && muiFormControl) shrink = muiFormControl.filled || muiFormControl.focused || muiFormControl.adornedStart;
	const ownerState = {
		...props,
		disableAnimation,
		formControl: muiFormControl,
		shrink,
		size: fcs.size,
		variant: fcs.variant,
		required: fcs.required,
		focused: fcs.focused
	};
	const classes = useUtilityClasses$8(ownerState);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputLabelRoot, {
		"data-shrink": shrink,
		ref,
		className: clsx(classes.root, className),
		...other,
		ownerState,
		classes
	});
});
InputLabel.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"error",
		"info",
		"primary",
		"secondary",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	disableAnimation: import_prop_types.default.bool,
	disabled: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	focused: import_prop_types.default.bool,
	margin: import_prop_types.default.oneOf(["dense"]),
	required: import_prop_types.default.bool,
	shrink: import_prop_types.default.bool,
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["medium", "small"]), import_prop_types.default.string]),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	variant: import_prop_types.default.oneOf([
		"filled",
		"outlined",
		"standard"
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/List/ListContext.mjs
/**
* @ignore - internal component.
*/
var ListContext = /* @__PURE__ */ import_react.createContext({});
ListContext.displayName = "ListContext";
//#endregion
//#region frontend/node_modules/@mui/material/List/listClasses.mjs
function getListUtilityClass(slot) {
	return generateUtilityClass("MuiList", slot);
}
var listClasses = generateUtilityClasses("MuiList", [
	"root",
	"padding",
	"dense",
	"subheader"
]);
//#endregion
//#region frontend/node_modules/@mui/material/List/List.mjs
var useUtilityClasses$7 = (ownerState) => {
	const { classes, disablePadding, dense, subheader } = ownerState;
	return composeClasses({ root: [
		"root",
		!disablePadding && "padding",
		dense && "dense",
		subheader && "subheader"
	] }, getListUtilityClass, classes);
};
var ListRoot = styled("ul", {
	name: "MuiList",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.root,
			!ownerState.disablePadding && styles.padding,
			ownerState.dense && styles.dense,
			ownerState.subheader && styles.subheader
		];
	}
})({
	listStyle: "none",
	margin: 0,
	padding: 0,
	position: "relative",
	variants: [{
		props: ({ ownerState }) => !ownerState.disablePadding,
		style: {
			paddingTop: 8,
			paddingBottom: 8
		}
	}, {
		props: ({ ownerState }) => ownerState.subheader,
		style: {
			paddingTop: 0,
			isolation: "isolate"
		}
	}]
});
var List = /* @__PURE__ */ import_react.forwardRef(function List(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiList"
	});
	const { children, className, component = "ul", dense = false, disablePadding = false, subheader, ...other } = props;
	const context = import_react.useMemo(() => ({ dense }), [dense]);
	const ownerState = {
		...props,
		component,
		dense,
		disablePadding
	};
	const classes = useUtilityClasses$7(ownerState);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListContext.Provider, {
		value: context,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ListRoot, {
			as: component,
			className: clsx(classes.root, className),
			ref,
			ownerState,
			...other,
			children: [subheader, children]
		})
	});
});
List.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	component: import_prop_types.default.elementType,
	dense: import_prop_types.default.bool,
	disablePadding: import_prop_types.default.bool,
	subheader: import_prop_types.default.node,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	])
};
//#endregion
//#region frontend/node_modules/@mui/utils/useRovingTabIndex/RovingTabIndexContext.mjs
var RovingTabIndexContext = /* @__PURE__ */ import_react.createContext(void 0);
RovingTabIndexContext.displayName = "RovingTabIndexContext";
function useRovingTabIndexContext() {
	const context = import_react.useContext(RovingTabIndexContext);
	if (context === void 0) throw new Error("MUI: RovingTabIndexContext is missing. Roving tab index items must be placed within a roving tab index provider.");
	return context;
}
//#endregion
//#region frontend/node_modules/@mui/utils/fastObjectShallowCompare/fastObjectShallowCompare.mjs
var is = Object.is;
/**
* Fast shallow compare for plain objects.
* Returns `true` when both objects have the same own enumerable keys and each value is equal
* according to `Object.is()`.
*/
function fastObjectShallowCompare(a, b) {
	if (a === b) return true;
	if (!(a instanceof Object) || !(b instanceof Object)) return false;
	let aLength = 0;
	let bLength = 0;
	for (const key in a) {
		aLength += 1;
		if (!is(a[key], b[key])) return false;
		if (!(key in b)) return false;
	}
	for (const _ in b) bLength += 1;
	return aLength === bLength;
}
//#endregion
//#region frontend/node_modules/@mui/utils/useRovingTabIndex/useRovingTabIndex.mjs
var SUPPORTED_KEYS = [
	"ArrowRight",
	"ArrowLeft",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End"
];
/**
* Provides roving tab index behavior for a composite container and its focusable children.
* This is useful for implementing keyboard navigation in components like menus, tabs, and lists.
* The hook manages the focus state of child elements and provides props to be spread on both the container and the items.
* The container will handle keyboard events to move focus between items based on the specified orientation and wrapping behavior.
*/
function useRovingTabIndexRoot(params) {
	const { activeItemId: activeItemIdProp, getDefaultActiveItemId, orientation, isRtl = false, isItemFocusable: itemFilter = isItemFocusable, wrap = true } = params;
	const [activeItemIdState, setActiveItemIdState] = import_react.useState(activeItemIdProp);
	const [previousActiveItemIdProp, setPreviousActiveItemIdProp] = import_react.useState(activeItemIdProp);
	let activeItemIdCandidate = activeItemIdState;
	if (activeItemIdProp !== previousActiveItemIdProp) {
		setPreviousActiveItemIdProp(activeItemIdProp);
		if (activeItemIdProp !== void 0 && activeItemIdProp !== activeItemIdState) {
			activeItemIdCandidate = activeItemIdProp;
			setActiveItemIdState(activeItemIdProp);
		}
	}
	const containerRef = import_react.useRef(null);
	const itemMapRef = import_react.useRef(/* @__PURE__ */ new Map());
	const [mapTick, setMapTick] = import_react.useState(0);
	const orderedItems = import_react.useMemo(() => {
		return getOrderedItems(itemMapRef.current);
	}, [mapTick]);
	const resolvedActiveItemId = resolveActiveItemId(activeItemIdCandidate, orderedItems, itemFilter, getDefaultActiveItemId);
	const activeItemIdRef = import_react.useRef(resolvedActiveItemId);
	activeItemIdRef.current = resolvedActiveItemId;
	const getActiveItem = import_react.useCallback(() => {
		const snapshot = getOrderedItems(itemMapRef.current);
		return getItemById(snapshot, resolveActiveItemId(activeItemIdRef.current, snapshot, itemFilter, getDefaultActiveItemId));
	}, [getDefaultActiveItemId, itemFilter]);
	const getItemMap = import_react.useCallback(() => {
		return itemMapRef.current;
	}, []);
	const registerItem = useEventCallback((item) => {
		if (fastObjectShallowCompare(itemMapRef.current.get(item.id) ?? null, item)) return;
		itemMapRef.current.set(item.id, item);
		setMapTick((value) => value + 1);
	});
	const unregisterItem = useEventCallback((itemId) => {
		if (itemMapRef.current.delete(itemId)) setMapTick((value) => value + 1);
	});
	const setActiveItemId = useEventCallback((itemId) => {
		setActiveItemIdState(itemId);
	});
	const isItemActive = import_react.useCallback((itemId) => {
		return activeItemIdRef.current === itemId;
	}, []);
	const focusItem = import_react.useCallback((currentIndex, direction, wrap, isItemFocusableOverride) => {
		const nextItem = getNextActiveItem(getNavigableItemsSnapshot(itemMapRef.current), currentIndex, direction, wrap, isItemFocusableOverride ?? itemFilter);
		if (!nextItem) return null;
		nextItem.element?.focus();
		setActiveItemIdState(nextItem.id);
		return nextItem;
	}, [itemFilter]);
	const getContainerProps = import_react.useCallback((ref) => {
		const onFocus = (event) => {
			const snapshot = getNavigableItemsSnapshot(itemMapRef.current);
			const focusedIndex = findItemIndexByElement(snapshot, event.target);
			if (focusedIndex !== -1) setActiveItemIdState(snapshot[focusedIndex].id);
		};
		const onKeyDown = (event) => {
			if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
			if (!SUPPORTED_KEYS.includes(event.key)) return;
			let previousItemKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
			let nextItemKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
			if (orientation === "horizontal" && isRtl) {
				previousItemKey = "ArrowRight";
				nextItemKey = "ArrowLeft";
			}
			const snapshot = getNavigableItemsSnapshot(itemMapRef.current);
			const currentFocus = activeElement(ownerDocument(containerRef.current));
			const isFocusOnContainer = currentFocus === containerRef.current;
			let currentIndex = getCurrentActiveItemIndex(snapshot, currentFocus, activeItemIdRef.current);
			let direction = "next";
			switch (event.key) {
				case previousItemKey:
					direction = "previous";
					event.preventDefault();
					if (isFocusOnContainer) currentIndex = snapshot.length;
					break;
				case nextItemKey:
					event.preventDefault();
					if (isFocusOnContainer) currentIndex = -1;
					break;
				case "Home":
					event.preventDefault();
					currentIndex = -1;
					break;
				case "End":
					event.preventDefault();
					direction = "previous";
					currentIndex = snapshot.length;
					break;
				default: return;
			}
			focusItem(currentIndex, direction, wrap);
		};
		return {
			onFocus,
			onKeyDown,
			ref: handleRefs(ref, (elementNode) => {
				containerRef.current = elementNode;
			})
		};
	}, [
		focusItem,
		isRtl,
		orientation,
		wrap
	]);
	const focusNext = import_react.useCallback((isItemFocusableOverride) => {
		const snapshot = getNavigableItemsSnapshot(itemMapRef.current);
		const currentFocus = activeElement(ownerDocument(containerRef.current));
		return focusItem(currentFocus === containerRef.current ? -1 : getCurrentActiveItemIndex(snapshot, currentFocus, activeItemIdRef.current), "next", true, isItemFocusableOverride)?.id ?? null;
	}, [focusItem]);
	return import_react.useMemo(() => ({
		activeItemId: resolvedActiveItemId,
		focusNext,
		getActiveItem,
		getContainerProps,
		getItemMap,
		isItemActive,
		registerItem,
		setActiveItemId,
		unregisterItem
	}), [
		resolvedActiveItemId,
		focusNext,
		getActiveItem,
		getContainerProps,
		getItemMap,
		isItemActive,
		registerItem,
		setActiveItemId,
		unregisterItem
	]);
}
function useRovingTabIndexItem(params) {
	const { activeItemId, registerItem, unregisterItem } = useRovingTabIndexContext();
	const elementRef = import_react.useRef(null);
	const item = import_react.useMemo(() => ({
		disabled: params.disabled ?? false,
		element: null,
		focusableWhenDisabled: params.focusableWhenDisabled ?? false,
		id: params.id,
		selected: params.selected ?? false,
		textValue: params.textValue
	}), [
		params.disabled,
		params.focusableWhenDisabled,
		params.id,
		params.selected,
		params.textValue
	]);
	const latestItemRef = import_react.useRef(item);
	latestItemRef.current = item;
	const handleElementRef = import_react.useCallback((element) => {
		elementRef.current = element;
		if (element == null) {
			queueMicrotask(() => {
				if (elementRef.current == null) unregisterItem(params.id);
			});
			return;
		}
		registerItem({
			...latestItemRef.current,
			element
		});
	}, [
		params.id,
		registerItem,
		unregisterItem
	]);
	const mergedRef = useForkRef(params.ref, handleElementRef);
	useEnhancedEffect(() => {
		if (!elementRef.current) return;
		registerItem({
			...item,
			element: elementRef.current
		});
	}, [item, registerItem]);
	useEnhancedEffect(() => {
		const itemId = params.id;
		return () => {
			unregisterItem(itemId);
		};
	}, [params.id, unregisterItem]);
	return {
		ref: mergedRef,
		tabIndex: activeItemId === params.id ? 0 : -1
	};
}
/**
* Resolves which item id should own the roving tab stop for the current render.
*
* This is the top-level decision point for "who gets `tabIndex=0` right now?".
* For example:
* - `Tabs` sometimes passes `selectedValue` as `activeItemId` so the selected tab becomes
*   the tab stop when focus enters the list from outside.
* - `MenuList` leaves `activeItemId` undefined and relies on the default-item logic below
*   so that menu-specific rules decide which menu item should initially own the tab stop.
*
* @param activeItemId The item id supplied through the root hook's `activeItemId` option.
*   `undefined` means "the caller did not ask for a specific item, use the default-item
*   logic instead". `null` means "there is intentionally no preferred item, so also fall
*   back to the default-item logic".
* @param items The ordered registered items currently in the roving set.
* @param isFocusable A predicate that decides whether an item may receive roving focus.
* @param getDefaultActiveItemId Optional caller-provided function that picks the preferred
*   default item when `activeItemId` is not driving the tab stop directly.
* @returns The id of the item that should own `tabIndex=0`, or `null` if no item is focusable.
*/
function resolveActiveItemId(activeItemId, items, isFocusable, getDefaultActiveItemId) {
	if (activeItemId != null) return resolveRequestedItemId(activeItemId, items, isFocusable);
	return resolveDefaultItemId(items, isFocusable, getDefaultActiveItemId);
}
/**
* Resolves the item id supplied through the root hook's `activeItemId` option.
*
* This path is used when a component such as `Tabs` or `MenuList` wants roving focus to
* follow a specific logical item. For example, `Tabs` can pass the selected tab's value as
* `activeItemId` so that the selected tab owns `tabIndex=0` when focus enters the list.
*
* @param requestedItemId The item id passed to the root hook's `activeItemId` option.
* @param items The ordered registered items currently in the roving set.
* @param isFocusable A predicate that decides whether an item may receive roving focus.
* @returns The same id when it still points to a focusable item. If that id no longer exists,
*   returns the first focusable item. If the id still exists but the item is not focusable,
*   returns the next focusable item after it without wrapping.
*/
function resolveRequestedItemId(requestedItemId, items, isFocusable) {
	const requestedItemIndex = findItemIndexById(items, requestedItemId);
	if (requestedItemIndex === -1) return getFirstFocusableItemId(items, isFocusable);
	if (isFocusable(items[requestedItemIndex])) return items[requestedItemIndex].id;
	return getNextActiveItem(items, requestedItemIndex, "next", false, isFocusable)?.id ?? null;
}
/**
* Resolves the default active item when the caller is not driving roving focus with
* `activeItemId`.
*
* This path is used on the initial render and whenever the caller leaves the choice of tab
* stop to the hook. `getDefaultActiveItemId` lets a component prefer a specific logical item
* before falling back to the first focusable item.
*
* For example:
* - `MenuList` uses this path all the time. When `variant="selectedMenu"`, it prefers the
*   selected menu item; otherwise it prefers the first focusable menu item.
* - `Tabs` uses this path while focus is already inside the tab list, because at that point
*   the current roving position should be driven by actual focus movement rather than by the
*   selected tab value.
*
* @param items The ordered registered items currently in the roving set.
* @param isFocusable A predicate that decides whether an item may receive roving focus.
* @param getDefaultActiveItemId Optional caller-provided function that chooses which item
*   should own the tab stop before the generic "first focusable item" fallback runs.
* @returns The default item id when it points to a focusable item, otherwise the first
*   focusable item in the snapshot, or `null` when none are focusable.
*/
function resolveDefaultItemId(items, isFocusable, getDefaultActiveItemId) {
	const defaultItemId = getDefaultActiveItemId?.(items);
	if (defaultItemId != null) {
		const defaultItem = getItemById(items, defaultItemId);
		if (defaultItem && isFocusable(defaultItem)) return defaultItem.id;
	}
	return getFirstFocusableItemId(items, isFocusable);
}
/**
* Finds the best starting index for keyboard navigation.
*
* This is used immediately before keyboard navigation and `focusNext()` navigation. It prefers
* the item that currently holds DOM focus, but if focus is on the container or outside the item
* set it falls back to the last known active item id.
*
* @param items The navigable item snapshot used for the current keyboard interaction.
* @param currentFocus The element that currently has DOM focus, if any.
* @param fallbackActiveItemId The last known active item id when focus is not on an item.
* @returns The focused item's index when focus is currently on an item. Otherwise, the index
*   of the fallback active item id, or `-1` when no matching item exists.
*/
function getCurrentActiveItemIndex(items, currentFocus, fallbackActiveItemId) {
	if (currentFocus) {
		const focusedIndex = findItemIndexByElement(items, currentFocus);
		if (focusedIndex !== -1) return focusedIndex;
	}
	return findItemIndexById(items, fallbackActiveItemId);
}
/**
* Walks the item snapshot to find the next focusable item in the requested direction.
*
* This is the shared navigation primitive used by keyboard handling and imperative helpers
* such as `focusNext()`. It starts from the supplied index, advances through the snapshot in
* the requested direction, and skips over items that fail the `isFocusable` predicate.
*
* @param items The ordered navigable item snapshot.
* @param currentIndex The index to start from. Use `-1` to start before the first item or
*   `items.length` to start after the last item.
* @param direction The direction to move through the snapshot.
* @param wrap Whether navigation should wrap around at the ends of the list.
* @param isFocusable A predicate that decides whether an item may receive roving focus.
* @returns The next focusable item record, or `null` when no focusable item can be reached.
*/
function getNextActiveItem(items, currentIndex, direction, wrap, isFocusable) {
	const lastIndex = items.length - 1;
	if (lastIndex === -1) return null;
	let wrappedOnce = false;
	let nextIndex = getNextIndex(currentIndex, lastIndex, direction, wrap);
	const startIndex = nextIndex;
	while (nextIndex !== -1) {
		if (nextIndex === startIndex) {
			if (wrappedOnce) return null;
			wrappedOnce = true;
		}
		const nextItem = items[nextIndex];
		if (!nextItem || !isFocusable(nextItem)) nextIndex = getNextIndex(nextIndex, lastIndex, direction, wrap);
		else return nextItem;
	}
	return null;
}
function getFirstFocusableItemId(items, isFocusable) {
	return items.find((item) => isFocusable(item))?.id ?? null;
}
function getItemById(items, itemId) {
	return itemId == null ? null : items.find((item) => item.id === itemId) ?? null;
}
function findItemIndexById(items, itemId) {
	return itemId == null ? -1 : items.findIndex((item) => item.id === itemId);
}
function findItemIndexByElement(items, element) {
	if (!element) return -1;
	return items.findIndex((item) => item.element === element || item.element?.contains(element));
}
function getOrderedItems(itemMap) {
	const items = Array.from(itemMap.values());
	if (items.every((item) => item.element == null)) return items;
	const connectedItems = items.filter(isConnectedItem).sort((itemA, itemB) => sortByDocumentPosition(itemA.element, itemB.element));
	const disconnectedItems = items.filter((item) => !isConnectedItem(item));
	return [...connectedItems, ...disconnectedItems];
}
function getNavigableItemsSnapshot(itemMap) {
	return getOrderedItems(itemMap).filter(isConnectedItem);
}
function getNextIndex(currentIndex, lastIndex, direction, wrap = true) {
	if (direction === "next") {
		if (currentIndex === lastIndex) return wrap ? 0 : -1;
		return currentIndex + 1;
	}
	if (currentIndex === 0) return wrap ? lastIndex : -1;
	return currentIndex - 1;
}
function isItemFocusable(item) {
	if (!item.element) return false;
	if (item.focusableWhenDisabled) return true;
	return !item.disabled && !item.element.hasAttribute("disabled") && item.element.getAttribute("aria-disabled") !== "true" && item.element.hasAttribute("tabindex");
}
function isConnectedItem(item) {
	return item.element != null && item.element.isConnected;
}
function sortByDocumentPosition(a, b) {
	if (a === b) return 0;
	const position = a.compareDocumentPosition(b);
	if (position & Node.DOCUMENT_POSITION_FOLLOWING || position & Node.DOCUMENT_POSITION_CONTAINED_BY) return -1;
	if (position & Node.DOCUMENT_POSITION_PRECEDING || position & Node.DOCUMENT_POSITION_CONTAINS) return 1;
	return 0;
}
function handleRefs(...refs) {
	return (node) => {
		refs.forEach((ref) => {
			setRef(ref ?? null, node);
		});
	};
}
//#endregion
//#region frontend/node_modules/@mui/material/utils/getScrollbarSize.mjs
var getScrollbarSize_default = getScrollbarSize;
//#endregion
//#region frontend/node_modules/@mui/material/utils/focusWithVisible.mjs
/**
* If `focusSource` is present, attempt to pass `focusVisible` through `focus()` options.
* Fall back to a plain focus call when the browser does not support it.
*/
function focusWithVisible(element, focusSource) {
	if (focusSource == null) {
		element.focus();
		return;
	}
	try {
		element.focus({ focusVisible: focusSource === "keyboard" });
	} catch (error) {
		element.focus();
	}
}
//#endregion
//#region frontend/node_modules/@mui/material/Select/utils/getOpenInteractionType.mjs
function getOpenInteractionType(event) {
	if (!event) return null;
	if (event.type === "mousedown" || event.type === "pointerdown" || event.type === "touchstart") return "pointer";
	if (event.type === "keydown" || event.type === "click" && event.detail === 0) return "keyboard";
	return null;
}
//#endregion
//#region frontend/node_modules/@mui/material/Select/utils/isEmpty.mjs
function isEmpty(display) {
	return display == null || typeof display === "string" && !display.trim();
}
//#endregion
//#region frontend/node_modules/@mui/material/Select/utils/areEqualValues.mjs
function areEqualValues(a, b) {
	if (typeof b === "object" && b !== null) return a === b;
	return String(a) === String(b);
}
//#endregion
//#region frontend/node_modules/@mui/material/Select/utils/SelectFocusSourceContext.mjs
var SelectFocusSourceContext = /* @__PURE__ */ import_react.createContext(null);
SelectFocusSourceContext.displayName = "SelectFocusSourceContext";
function useSelectFocusSource() {
	return import_react.useContext(SelectFocusSourceContext);
}
var SelectFocusSourceProvider = SelectFocusSourceContext.Provider;
//#endregion
//#region frontend/node_modules/@mui/material/MenuList/MenuListContext.mjs
/**
* @ignore - internal component.
*/
var MenuListContext = /* @__PURE__ */ import_react.createContext(void 0);
MenuListContext.displayName = "MenuListContext";
function useMenuListContext() {
	const context = import_react.useContext(MenuListContext);
	if (context === void 0) throw new Error("MUI: MenuListContext is missing. MenuItems must be placed within Menu or MenuList.");
	return context;
}
//#endregion
//#region frontend/node_modules/@mui/material/MenuList/MenuList.mjs
function getItemText(itemOrElement) {
	const element = itemOrElement?.element ?? itemOrElement;
	if (!element) return "";
	if (itemOrElement?.textValue !== void 0) return itemOrElement.textValue;
	let text = element.innerText;
	if (text === void 0) text = element.textContent;
	return text ?? "";
}
function textCriteriaMatches(itemOrElement, textCriteria) {
	if (textCriteria === void 0) return true;
	let text = getItemText(itemOrElement);
	text = text.trim().toLowerCase();
	if (text.length === 0) return false;
	if (textCriteria.repeating) return text[0] === textCriteria.keys[0];
	return text.startsWith(textCriteria.keys.join(""));
}
function isItemFocusableWithTextCriteria(item, criteria) {
	if (!textCriteriaMatches(item, criteria)) return false;
	return isItemFocusable(item);
}
function focusInitialItem(element, focusSource) {
	focusWithVisible(element, focusSource);
}
/**
* A permanently displayed menu following https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/.
* It's exposed to help customization of the [`Menu`](/material-ui/api/menu/) component if you
* use it separately you need to move focus into the component manually. Once
* the focus is placed inside the component it is fully keyboard accessible.
*/
var MenuList = /* @__PURE__ */ import_react.forwardRef(function MenuList(props, ref) {
	const { actions, autoFocus: autoFocusList = false, autoFocusItem: autoFocusActiveItem = false, children, className, disabledItemsFocusable = false, disableListWrap = false, onKeyDown, variant = "selectedMenu", ...other } = props;
	const listRef = import_react.useRef(null);
	const hasFocusedInitialTargetRef = import_react.useRef(false);
	const [suppressInitialFocusVisible, setSuppressInitialFocusVisible] = import_react.useState(false);
	const focusSource = useSelectFocusSource();
	const textCriteriaRef = import_react.useRef({
		keys: [],
		repeating: true,
		previousKeyMatched: true,
		lastTime: null
	});
	const rovingContainer = useRovingTabIndexRoot({
		activeItemId: void 0,
		getDefaultActiveItemId: import_react.useCallback((items) => {
			if (variant === "selectedMenu") return items.find((item) => item.selected && isItemFocusable(item))?.id ?? items.find((item) => isItemFocusable(item))?.id ?? null;
			return items.find((item) => isItemFocusable(item))?.id ?? null;
		}, [variant]),
		orientation: "vertical",
		wrap: !disableListWrap
	});
	const { activeItemId, focusNext, getActiveItem, getContainerProps, getItemMap } = rovingContainer;
	const focusInitialTarget = useEventCallback_default((force = false) => {
		if (!listRef.current || !force && hasFocusedInitialTargetRef.current) return null;
		if (autoFocusActiveItem) {
			const activeItem = getActiveItem();
			if (activeItem?.element) {
				const hasSelectedItem = Array.from(getItemMap().values()).some((item) => item.selected);
				setSuppressInitialFocusVisible(variant === "menu" && hasSelectedItem && !activeItem.selected && focusSource == null);
				focusInitialItem(activeItem.element, focusSource);
				hasFocusedInitialTargetRef.current = true;
				return activeItem.element;
			}
			if (!autoFocusList) return null;
			setSuppressInitialFocusVisible(false);
			listRef.current.focus();
			return listRef.current;
		}
		if (!autoFocusList) {
			setSuppressInitialFocusVisible(false);
			return null;
		}
		setSuppressInitialFocusVisible(false);
		listRef.current.focus();
		hasFocusedInitialTargetRef.current = true;
		return listRef.current;
	});
	useEnhancedEffect_default(() => {
		if (!autoFocusList && !autoFocusActiveItem) {
			hasFocusedInitialTargetRef.current = false;
			setSuppressInitialFocusVisible(false);
			return;
		}
		focusInitialTarget();
	}, [
		activeItemId,
		autoFocusActiveItem,
		autoFocusList,
		focusInitialTarget
	]);
	import_react.useImperativeHandle(actions, () => ({
		adjustStyleForScrollbar: (containerElement, { direction }) => {
			const noExplicitWidth = !listRef.current.style.width;
			if (containerElement.clientHeight < listRef.current.clientHeight && noExplicitWidth) {
				const scrollbarSize = `${getScrollbarSize_default(ownerWindow_default(containerElement))}px`;
				listRef.current.style[direction === "rtl" ? "paddingLeft" : "paddingRight"] = scrollbarSize;
				listRef.current.style.width = `calc(100% + ${scrollbarSize})`;
			}
			return listRef.current;
		},
		focusInitialTarget: () => {
			if (!listRef.current) return null;
			const currentFocus = getActiveElement_default(ownerDocument_default(listRef.current));
			if (currentFocus && contains_default(listRef.current, currentFocus)) return currentFocus;
			return focusInitialTarget(true);
		}
	}), [focusInitialTarget]);
	const rovingContainerProps = getContainerProps();
	const handleRef = useForkRef_default(listRef, rovingContainerProps.ref, ref);
	const menuListContextValue = import_react.useMemo(() => ({
		itemsFocusableWhenDisabled: disabledItemsFocusable,
		suppressInitialFocusVisible,
		variant
	}), [
		disabledItemsFocusable,
		suppressInitialFocusVisible,
		variant
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(List, {
		role: "menu",
		ref: handleRef,
		className,
		onKeyDown: useEventCallback_default((event) => {
			if (suppressInitialFocusVisible) setSuppressInitialFocusVisible(false);
			if ((event.ctrlKey || event.metaKey || event.altKey) && onKeyDown) {
				onKeyDown(event);
				return;
			}
			rovingContainerProps.onKeyDown(event);
			if (event.key.length === 1) {
				const criteria = textCriteriaRef.current;
				const lowerKey = event.key.toLowerCase();
				const currTime = performance.now();
				if (criteria.keys.length > 0) {
					if (currTime - criteria.lastTime > 500) {
						criteria.keys = [];
						criteria.repeating = true;
						criteria.previousKeyMatched = true;
					} else if (criteria.repeating && lowerKey !== criteria.keys[0]) criteria.repeating = false;
				}
				criteria.lastTime = currTime;
				criteria.keys.push(lowerKey);
				const currentFocus = getActiveElement_default(ownerDocument_default(listRef.current));
				const keepFocusOnCurrent = currentFocus && !criteria.repeating && textCriteriaMatches(currentFocus, criteria);
				if (criteria.previousKeyMatched && (keepFocusOnCurrent || focusNext((item) => isItemFocusableWithTextCriteria(item, criteria)) != null)) event.preventDefault();
				else criteria.previousKeyMatched = false;
			}
			if (onKeyDown) onKeyDown(event);
		}),
		onFocus: rovingContainerProps.onFocus,
		tabIndex: -1,
		...other,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuListContext.Provider, {
			value: menuListContextValue,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RovingTabIndexContext.Provider, {
				value: rovingContainer,
				children
			})
		})
	});
});
MenuList.propTypes = {
	autoFocus: import_prop_types.default.bool,
	autoFocusItem: import_prop_types.default.bool,
	children: import_prop_types.default.node,
	className: import_prop_types.default.string,
	disabledItemsFocusable: import_prop_types.default.bool,
	disableListWrap: import_prop_types.default.bool,
	onKeyDown: import_prop_types.default.func,
	variant: import_prop_types.default.oneOf(["menu", "selectedMenu"])
};
//#endregion
//#region frontend/node_modules/@mui/material/Popover/popoverClasses.mjs
function getPopoverUtilityClass(slot) {
	return generateUtilityClass("MuiPopover", slot);
}
var popoverClasses = generateUtilityClasses("MuiPopover", ["root", "paper"]);
//#endregion
//#region frontend/node_modules/@mui/material/Popover/Popover.mjs
function getOffsetTop(rect, vertical) {
	let offset = 0;
	if (typeof vertical === "number") offset = vertical;
	else if (vertical === "center") offset = rect.height / 2;
	else if (vertical === "bottom") offset = rect.height;
	return offset;
}
function getOffsetLeft(rect, horizontal) {
	let offset = 0;
	if (typeof horizontal === "number") offset = horizontal;
	else if (horizontal === "center") offset = rect.width / 2;
	else if (horizontal === "right") offset = rect.width;
	return offset;
}
function getTransformOriginValue(transformOrigin) {
	return [transformOrigin.horizontal, transformOrigin.vertical].map((n) => typeof n === "number" ? `${n}px` : n).join(" ");
}
function resolveAnchorEl(anchorEl) {
	return typeof anchorEl === "function" ? anchorEl() : anchorEl;
}
var useUtilityClasses$6 = (ownerState) => {
	const { classes } = ownerState;
	return composeClasses({
		root: ["root"],
		paper: ["paper"]
	}, getPopoverUtilityClass, classes);
};
var PopoverRoot = styled(Modal, {
	name: "MuiPopover",
	slot: "Root"
})({});
var PopoverPaper = styled(Paper, {
	name: "MuiPopover",
	slot: "Paper"
})({
	position: "absolute",
	overflowY: "auto",
	overflowX: "hidden",
	minWidth: 16,
	minHeight: 16,
	maxWidth: "calc(100% - 32px)",
	maxHeight: "calc(100% - 32px)",
	outline: 0
});
var Popover = /* @__PURE__ */ import_react.forwardRef(function Popover(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiPopover"
	});
	const { action, anchorEl, anchorOrigin = {
		vertical: "top",
		horizontal: "left"
	}, anchorPosition, anchorReference = "anchorEl", children, className, container: containerProp, disableAutoFocus = false, elevation = 8, marginThreshold = 16, open, slots = {}, slotProps = {}, transformOrigin = {
		vertical: "top",
		horizontal: "left"
	}, transitionDuration: transitionDurationProp = "auto", disableScrollLock = false, ...other } = props;
	const paperRef = import_react.useRef();
	const ownerState = {
		...props,
		anchorOrigin,
		anchorReference,
		elevation,
		marginThreshold,
		transformOrigin,
		transitionDuration: transitionDurationProp
	};
	const classes = useUtilityClasses$6(ownerState);
	const getAnchorOffset = import_react.useCallback(() => {
		if (anchorReference === "anchorPosition") {
			if (!anchorPosition) console.error("MUI: You need to provide a `anchorPosition` prop when using <Popover anchorReference=\"anchorPosition\" />.");
			return anchorPosition;
		}
		const resolvedAnchorEl = resolveAnchorEl(anchorEl);
		const anchorElement = resolvedAnchorEl && resolvedAnchorEl.nodeType === 1 ? resolvedAnchorEl : ownerDocument_default(paperRef.current).body;
		const anchorRect = anchorElement.getBoundingClientRect();
		{
			const box = anchorElement.getBoundingClientRect();
			if (isLayoutSupported() && box.top === 0 && box.left === 0 && box.right === 0 && box.bottom === 0) console.warn([
				"MUI: The `anchorEl` prop provided to the component is invalid.",
				"The anchor element should be part of the document layout.",
				"Make sure the element is present in the document or that it's not display none."
			].join("\n"));
		}
		return {
			top: anchorRect.top + getOffsetTop(anchorRect, anchorOrigin.vertical),
			left: anchorRect.left + getOffsetLeft(anchorRect, anchorOrigin.horizontal)
		};
	}, [
		anchorEl,
		anchorOrigin.horizontal,
		anchorOrigin.vertical,
		anchorPosition,
		anchorReference
	]);
	const getTransformOrigin = import_react.useCallback((elemRect) => {
		return {
			vertical: getOffsetTop(elemRect, transformOrigin.vertical),
			horizontal: getOffsetLeft(elemRect, transformOrigin.horizontal)
		};
	}, [transformOrigin.horizontal, transformOrigin.vertical]);
	const getPositioningStyle = import_react.useCallback((element) => {
		const elemRect = {
			width: element.offsetWidth,
			height: element.offsetHeight
		};
		const elemTransformOrigin = getTransformOrigin(elemRect);
		if (anchorReference === "none") return {
			top: null,
			left: null,
			transformOrigin: getTransformOriginValue(elemTransformOrigin)
		};
		const anchorOffset = getAnchorOffset();
		let top = anchorOffset.top - elemTransformOrigin.vertical;
		let left = anchorOffset.left - elemTransformOrigin.horizontal;
		const bottom = top + elemRect.height;
		const right = left + elemRect.width;
		const containerWindow = ownerWindow_default(resolveAnchorEl(anchorEl));
		const heightThreshold = containerWindow.innerHeight - marginThreshold;
		const widthThreshold = containerWindow.innerWidth - marginThreshold;
		if (marginThreshold != null && top < marginThreshold) {
			const diff = top - marginThreshold;
			top -= diff;
			elemTransformOrigin.vertical += diff;
		} else if (marginThreshold != null && bottom > heightThreshold) {
			const diff = bottom - heightThreshold;
			top -= diff;
			elemTransformOrigin.vertical += diff;
		}
		if (elemRect.height > heightThreshold && elemRect.height && heightThreshold) console.error([
			"MUI: The popover component is too tall.",
			`Some part of it can not be seen on the screen (${elemRect.height - heightThreshold}px).`,
			"Please consider adding a `max-height` to improve the user-experience."
		].join("\n"));
		if (marginThreshold != null && left < marginThreshold) {
			const diff = left - marginThreshold;
			left -= diff;
			elemTransformOrigin.horizontal += diff;
		} else if (right > widthThreshold) {
			const diff = right - widthThreshold;
			left -= diff;
			elemTransformOrigin.horizontal += diff;
		}
		return {
			top: `${Math.round(top)}px`,
			left: `${Math.round(left)}px`,
			transformOrigin: getTransformOriginValue(elemTransformOrigin)
		};
	}, [
		anchorEl,
		anchorReference,
		getAnchorOffset,
		getTransformOrigin,
		marginThreshold
	]);
	const [isPositioned, setIsPositioned] = import_react.useState(open);
	const setPositioningStyles = import_react.useCallback(() => {
		const element = paperRef.current;
		if (!element) return;
		const positioning = getPositioningStyle(element);
		if (positioning.top != null) element.style.setProperty("top", positioning.top);
		if (positioning.left != null) element.style.left = positioning.left;
		element.style.transformOrigin = positioning.transformOrigin;
		setIsPositioned(true);
	}, [getPositioningStyle]);
	import_react.useEffect(() => {
		if (disableScrollLock) window.addEventListener("scroll", setPositioningStyles);
		return () => window.removeEventListener("scroll", setPositioningStyles);
	}, [
		anchorEl,
		disableScrollLock,
		setPositioningStyles
	]);
	const handleEntering = () => {
		setPositioningStyles();
	};
	const handleExited = () => {
		setIsPositioned(false);
	};
	import_react.useEffect(() => {
		if (open) setPositioningStyles();
	});
	import_react.useImperativeHandle(action, () => open ? { updatePosition: () => {
		setPositioningStyles();
	} } : null, [open, setPositioningStyles]);
	import_react.useEffect(() => {
		if (!open) return;
		const handleResize = debounce_default(() => {
			setPositioningStyles();
		});
		const containerWindow = ownerWindow_default(resolveAnchorEl(anchorEl));
		containerWindow.addEventListener("resize", handleResize);
		return () => {
			handleResize.clear();
			containerWindow.removeEventListener("resize", handleResize);
		};
	}, [
		anchorEl,
		open,
		setPositioningStyles
	]);
	let transitionDuration = transitionDurationProp;
	const externalForwardedProps = {
		slots,
		slotProps
	};
	const [TransitionSlot, transitionSlotProps] = useSlot("transition", {
		elementType: Grow,
		externalForwardedProps,
		ownerState,
		getSlotProps: (handlers) => ({
			...handlers,
			onEntering: (element, isAppearing) => {
				handlers.onEntering?.(element, isAppearing);
				handleEntering();
			},
			onExited: (element) => {
				handlers.onExited?.(element);
				handleExited();
			}
		}),
		additionalProps: {
			appear: true,
			in: open
		}
	});
	if (transitionDurationProp === "auto" && !TransitionSlot.muiSupportAuto) transitionDuration = void 0;
	const container = containerProp || (anchorEl ? ownerDocument_default(resolveAnchorEl(anchorEl)).body : void 0);
	const [RootSlot, { slots: rootSlotsProp, slotProps: rootSlotPropsProp, ...rootProps }] = useSlot("root", {
		ref,
		elementType: PopoverRoot,
		externalForwardedProps: {
			...externalForwardedProps,
			...other
		},
		shouldForwardComponentProp: true,
		additionalProps: {
			slots: { backdrop: slots.backdrop },
			slotProps: { backdrop: mergeSlotProps(typeof slotProps.backdrop === "function" ? slotProps.backdrop(ownerState) : slotProps.backdrop, { invisible: true }) },
			container,
			open
		},
		ownerState,
		className: clsx(classes.root, className)
	});
	const [PaperSlot, paperProps] = useSlot("paper", {
		ref: paperRef,
		className: classes.paper,
		elementType: PopoverPaper,
		externalForwardedProps,
		shouldForwardComponentProp: true,
		additionalProps: {
			elevation,
			style: isPositioned ? void 0 : { opacity: 0 }
		},
		ownerState
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RootSlot, {
		...rootProps,
		...!isHostComponent(RootSlot) && {
			slots: rootSlotsProp,
			slotProps: rootSlotPropsProp,
			disableAutoFocus,
			disableScrollLock
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TransitionSlot, {
			...transitionSlotProps,
			timeout: transitionDuration,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperSlot, {
				...paperProps,
				children
			})
		})
	});
});
Popover.propTypes = {
	action: refType,
	anchorEl: chainPropTypes(import_prop_types.default.oneOfType([HTMLElementType, import_prop_types.default.func]), (props) => {
		if (props.open && (!props.anchorReference || props.anchorReference === "anchorEl")) {
			const resolvedAnchorEl = resolveAnchorEl(props.anchorEl);
			if (resolvedAnchorEl && resolvedAnchorEl.nodeType === 1) {
				const box = resolvedAnchorEl.getBoundingClientRect();
				if (isLayoutSupported() && box.top === 0 && box.left === 0 && box.right === 0 && box.bottom === 0) return new Error([
					"MUI: The `anchorEl` prop provided to the component is invalid.",
					"The anchor element should be part of the document layout.",
					"Make sure the element is present in the document or that it's not display none."
				].join("\n"));
			} else return new Error(["MUI: The `anchorEl` prop provided to the component is invalid.", `It should be an Element or PopoverVirtualElement instance but it's \`${resolvedAnchorEl}\` instead.`].join("\n"));
		}
		return null;
	}),
	anchorOrigin: import_prop_types.default.shape({
		horizontal: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
			"center",
			"left",
			"right"
		]), import_prop_types.default.number]).isRequired,
		vertical: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
			"bottom",
			"center",
			"top"
		]), import_prop_types.default.number]).isRequired
	}),
	anchorPosition: import_prop_types.default.shape({
		left: import_prop_types.default.number.isRequired,
		top: import_prop_types.default.number.isRequired
	}),
	anchorReference: import_prop_types.default.oneOf([
		"anchorEl",
		"anchorPosition",
		"none"
	]),
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	container: import_prop_types.default.oneOfType([HTMLElementType, import_prop_types.default.func]),
	disableAutoFocus: import_prop_types.default.bool,
	disableScrollLock: import_prop_types.default.bool,
	elevation: integerPropType,
	marginThreshold: import_prop_types.default.number,
	onClose: import_prop_types.default.func,
	open: import_prop_types.default.bool.isRequired,
	slotProps: import_prop_types.default.shape({
		backdrop: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		paper: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		transition: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		backdrop: import_prop_types.default.elementType,
		paper: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType,
		transition: import_prop_types.default.elementType
	}),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	transformOrigin: import_prop_types.default.shape({
		horizontal: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
			"center",
			"left",
			"right"
		]), import_prop_types.default.number]).isRequired,
		vertical: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
			"bottom",
			"center",
			"top"
		]), import_prop_types.default.number]).isRequired
	}),
	transitionDuration: import_prop_types.default.oneOfType([
		import_prop_types.default.oneOf(["auto"]),
		import_prop_types.default.number,
		import_prop_types.default.shape({
			appear: import_prop_types.default.number,
			enter: import_prop_types.default.number,
			exit: import_prop_types.default.number
		})
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/Menu/menuClasses.mjs
function getMenuUtilityClass(slot) {
	return generateUtilityClass("MuiMenu", slot);
}
var menuClasses = generateUtilityClasses("MuiMenu", [
	"root",
	"paper",
	"list"
]);
//#endregion
//#region frontend/node_modules/@mui/material/Menu/Menu.mjs
var RTL_ORIGIN = {
	vertical: "top",
	horizontal: "right"
};
var LTR_ORIGIN = {
	vertical: "top",
	horizontal: "left"
};
var useUtilityClasses$5 = (ownerState) => {
	const { classes } = ownerState;
	return composeClasses({
		root: ["root"],
		paper: ["paper"],
		list: ["list"]
	}, getMenuUtilityClass, classes);
};
var MenuRoot = styled(Popover, {
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) || prop === "classes",
	name: "MuiMenu",
	slot: "Root"
})({});
var MenuPaper = styled(PopoverPaper, {
	name: "MuiMenu",
	slot: "Paper"
})({
	maxHeight: "calc(100% - 96px)",
	WebkitOverflowScrolling: "touch"
});
var MenuMenuList = styled(MenuList, {
	name: "MuiMenu",
	slot: "List"
})({ outline: 0 });
var Menu = /* @__PURE__ */ import_react.forwardRef(function Menu(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiMenu"
	});
	const { autoFocus = true, children, className, disableAutoFocusItem = false, onClose, open, PopoverClasses, transitionDuration = "auto", variant = "selectedMenu", slots = {}, slotProps = {}, ...other } = props;
	const isRtl = useRtl();
	const ownerState = {
		...props,
		autoFocus,
		disableAutoFocusItem,
		transitionDuration,
		variant
	};
	const classes = useUtilityClasses$5(ownerState);
	const shouldManageInitialFocus = autoFocus && open;
	const shouldAutoFocusActiveItem = shouldManageInitialFocus && !disableAutoFocusItem;
	const menuListActionsRef = import_react.useRef(null);
	const handleEntering = (element, _isAppearing) => {
		if (menuListActionsRef.current) {
			menuListActionsRef.current.adjustStyleForScrollbar(element, { direction: isRtl ? "rtl" : "ltr" });
			if (shouldManageInitialFocus) menuListActionsRef.current.focusInitialTarget?.();
		}
	};
	const handleListKeyDown = (event) => {
		if (event.key === "Tab") {
			event.preventDefault();
			if (onClose) onClose(event, "tabKeyDown");
		}
	};
	const externalForwardedProps = {
		slots,
		slotProps
	};
	const rootSlotProps = useSlotProps({
		elementType: slots.root,
		externalSlotProps: slotProps.root,
		ownerState,
		className: [classes.root, className]
	});
	const [PaperSlot, paperSlotProps] = useSlot("paper", {
		className: classes.paper,
		elementType: MenuPaper,
		externalForwardedProps,
		shouldForwardComponentProp: true,
		ownerState
	});
	const [ListSlot, listSlotProps] = useSlot("list", {
		className: classes.list,
		elementType: MenuMenuList,
		shouldForwardComponentProp: true,
		externalForwardedProps,
		getSlotProps: (handlers) => ({
			...handlers,
			onKeyDown: (event) => {
				handleListKeyDown(event);
				handlers.onKeyDown?.(event);
			}
		}),
		ownerState
	});
	const resolvedTransitionProps = typeof slotProps.transition === "function" ? slotProps.transition(ownerState) : slotProps.transition;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MenuRoot, {
		disableAutoFocus: autoFocus,
		onClose,
		anchorOrigin: {
			vertical: "bottom",
			horizontal: isRtl ? "right" : "left"
		},
		transformOrigin: isRtl ? RTL_ORIGIN : LTR_ORIGIN,
		slots: {
			root: slots.root,
			paper: PaperSlot,
			backdrop: slots.backdrop,
			transition: slots.transition
		},
		slotProps: {
			root: rootSlotProps,
			paper: paperSlotProps,
			backdrop: typeof slotProps.backdrop === "function" ? slotProps.backdrop(ownerState) : slotProps.backdrop,
			transition: {
				...resolvedTransitionProps,
				onEntering: (...args) => {
					handleEntering(...args);
					resolvedTransitionProps?.onEntering?.(...args);
				}
			}
		},
		open,
		ref,
		transitionDuration,
		ownerState,
		...other,
		classes: PopoverClasses,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSlot, {
			actions: menuListActionsRef,
			autoFocus: shouldManageInitialFocus,
			autoFocusItem: shouldAutoFocusActiveItem,
			variant,
			...listSlotProps,
			children
		})
	});
});
Menu.propTypes = {
	anchorEl: import_prop_types.default.oneOfType([HTMLElementType, import_prop_types.default.func]),
	autoFocus: import_prop_types.default.bool,
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	disableAutoFocusItem: import_prop_types.default.bool,
	onClose: import_prop_types.default.func,
	open: import_prop_types.default.bool.isRequired,
	PopoverClasses: import_prop_types.default.object,
	slotProps: import_prop_types.default.shape({
		backdrop: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		list: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		paper: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		transition: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		backdrop: import_prop_types.default.elementType,
		list: import_prop_types.default.elementType,
		paper: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType,
		transition: import_prop_types.default.elementType
	}),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	transitionDuration: import_prop_types.default.oneOfType([
		import_prop_types.default.oneOf(["auto"]),
		import_prop_types.default.number,
		import_prop_types.default.shape({
			appear: import_prop_types.default.number,
			enter: import_prop_types.default.number,
			exit: import_prop_types.default.number
		})
	]),
	variant: import_prop_types.default.oneOf(["menu", "selectedMenu"])
};
//#endregion
//#region frontend/node_modules/@mui/material/NativeSelect/NativeSelectInput.mjs
var useUtilityClasses$4 = (ownerState) => {
	const { classes, variant, disabled, multiple, open, error } = ownerState;
	return composeClasses({
		select: [
			"select",
			variant,
			disabled && "disabled",
			multiple && "multiple",
			error && "error"
		],
		icon: [
			"icon",
			`icon${capitalize_default(variant)}`,
			open && "iconOpen",
			disabled && "disabled"
		]
	}, getNativeSelectUtilityClasses, classes);
};
var StyledSelectSelect = styled("select", { name: "MuiNativeSelect" })(({ theme }) => ({
	MozAppearance: "none",
	WebkitAppearance: "none",
	userSelect: "none",
	borderRadius: 0,
	cursor: "pointer",
	"&:focus": { borderRadius: 0 },
	[`&.${nativeSelectClasses.disabled}`]: { cursor: "default" },
	"&[multiple]": { height: "auto" },
	"&:not([multiple]) option, &:not([multiple]) optgroup": { backgroundColor: (theme.vars || theme).palette.background.paper },
	variants: [
		{
			props: ({ ownerState }) => ownerState.variant !== "filled" && ownerState.variant !== "outlined",
			style: { "&&&": {
				paddingRight: 24,
				minWidth: 16
			} }
		},
		{
			props: { variant: "filled" },
			style: { "&&&": { paddingRight: 32 } }
		},
		{
			props: { variant: "outlined" },
			style: {
				borderRadius: (theme.vars || theme).shape.borderRadius,
				"&:focus": { borderRadius: (theme.vars || theme).shape.borderRadius },
				"&&&": { paddingRight: 32 }
			}
		}
	]
}));
var NativeSelectSelect = styled(StyledSelectSelect, {
	name: "MuiNativeSelect",
	slot: "Select",
	shouldForwardProp: rootShouldForwardProp,
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.select,
			styles[ownerState.variant],
			ownerState.error && styles.error,
			{ [`&.${nativeSelectClasses.multiple}`]: styles.multiple }
		];
	}
})({});
var StyledSelectIcon = styled("svg", { name: "MuiNativeSelect" })(({ theme }) => ({
	position: "absolute",
	right: 0,
	top: "calc(50% - .5em)",
	pointerEvents: "none",
	color: (theme.vars || theme).palette.action.active,
	[`&.${nativeSelectClasses.disabled}`]: { color: (theme.vars || theme).palette.action.disabled },
	variants: [
		{
			props: ({ ownerState }) => ownerState.open,
			style: { transform: "rotate(180deg)" }
		},
		{
			props: { variant: "filled" },
			style: { right: 7 }
		},
		{
			props: { variant: "outlined" },
			style: { right: 7 }
		}
	]
}));
var NativeSelectIcon = styled(StyledSelectIcon, {
	name: "MuiNativeSelect",
	slot: "Icon",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.icon,
			ownerState.variant && styles[`icon${capitalize_default(ownerState.variant)}`],
			ownerState.open && styles.iconOpen
		];
	}
})({});
/**
* @ignore - internal component.
*/
var NativeSelectInput = /* @__PURE__ */ import_react.forwardRef(function NativeSelectInput(props, ref) {
	const { className, disabled, error, IconComponent, inputRef, variant = "standard", ...other } = props;
	const ownerState = {
		...props,
		disabled,
		variant,
		error
	};
	const classes = useUtilityClasses$4(ownerState);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NativeSelectSelect, {
		ownerState,
		className: clsx(classes.select, className),
		disabled,
		ref: inputRef || ref,
		...other
	}), props.multiple ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NativeSelectIcon, {
		as: IconComponent,
		ownerState,
		className: classes.icon
	})] });
});
NativeSelectInput.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	disabled: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	IconComponent: import_prop_types.default.elementType.isRequired,
	inputRef: refType,
	multiple: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	onChange: import_prop_types.default.func,
	value: import_prop_types.default.any,
	variant: import_prop_types.default.oneOf([
		"standard",
		"outlined",
		"filled"
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/OutlinedInput/NotchedOutline.mjs
var _span$1;
var NotchedOutlineRoot$1 = styled("fieldset", {
	name: "MuiNotchedOutlined",
	shouldForwardProp: rootShouldForwardProp
})({
	textAlign: "left",
	position: "absolute",
	bottom: 0,
	right: 0,
	top: -5,
	left: 0,
	margin: 0,
	padding: "0 8px",
	pointerEvents: "none",
	borderRadius: "inherit",
	borderStyle: "solid",
	borderWidth: 1,
	overflow: "hidden",
	minWidth: "0%"
});
var NotchedOutlineLegend = styled("legend", {
	name: "MuiNotchedOutlined",
	shouldForwardProp: rootShouldForwardProp
})(memoTheme(({ theme }) => ({
	float: "unset",
	width: "auto",
	overflow: "hidden",
	variants: [
		{
			props: ({ ownerState }) => !ownerState.withLabel,
			style: {
				padding: 0,
				lineHeight: "11px",
				...getTransitionStyles(theme, "width", {
					duration: 150,
					easing: theme.transitions.easing.easeOut
				})
			}
		},
		{
			props: ({ ownerState }) => ownerState.withLabel,
			style: {
				display: "block",
				padding: 0,
				height: 11,
				fontSize: "0.75em",
				visibility: "hidden",
				maxWidth: .01,
				...getTransitionStyles(theme, "max-width", {
					duration: 50,
					easing: theme.transitions.easing.easeOut
				}),
				whiteSpace: "nowrap",
				"& > span": {
					paddingLeft: 5,
					paddingRight: 5,
					display: "inline-block",
					opacity: 0,
					visibility: "visible"
				}
			}
		},
		{
			props: ({ ownerState }) => ownerState.withLabel && ownerState.notched,
			style: {
				maxWidth: "100%",
				...getTransitionStyles(theme, "max-width", {
					duration: 100,
					easing: theme.transitions.easing.easeOut,
					delay: 50
				})
			}
		}
	]
})));
/**
* @ignore - internal component.
*/
function NotchedOutline(props) {
	const { children, classes, className, label, notched, ...other } = props;
	const withLabel = label != null && label !== "";
	const ownerState = {
		...props,
		notched,
		withLabel
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NotchedOutlineRoot$1, {
		"aria-hidden": true,
		className,
		ownerState,
		...other,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NotchedOutlineLegend, {
			ownerState,
			children: withLabel ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }) : _span$1 || (_span$1 = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "notranslate",
				"aria-hidden": true,
				children: "​"
			}))
		})
	});
}
NotchedOutline.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	label: import_prop_types.default.node,
	notched: import_prop_types.default.bool.isRequired,
	style: import_prop_types.default.object
};
//#endregion
//#region frontend/node_modules/@mui/material/OutlinedInput/OutlinedInput.mjs
var useUtilityClasses$3 = (ownerState) => {
	const { classes } = ownerState;
	const composedClasses = composeClasses({
		root: ["root"],
		notchedOutline: ["notchedOutline"],
		input: ["input"]
	}, getOutlinedInputUtilityClass, classes);
	return {
		...classes,
		...composedClasses
	};
};
var OutlinedInputRoot = styled(InputBaseRoot, {
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) || prop === "classes",
	name: "MuiOutlinedInput",
	slot: "Root",
	overridesResolver: rootOverridesResolver
})(memoTheme(({ theme }) => {
	const borderColor = theme.palette.mode === "light" ? "rgba(0, 0, 0, 0.23)" : "rgba(255, 255, 255, 0.23)";
	return {
		position: "relative",
		borderRadius: (theme.vars || theme).shape.borderRadius,
		[`&:hover .${outlinedInputClasses.notchedOutline}`]: { borderColor: (theme.vars || theme).palette.text.primary },
		"@media (hover: none)": { [`&:hover .${outlinedInputClasses.notchedOutline}`]: { borderColor: theme.vars ? theme.alpha(theme.vars.palette.common.onBackground, .23) : borderColor } },
		[`&.${outlinedInputClasses.focused} .${outlinedInputClasses.notchedOutline}`]: { borderWidth: 2 },
		variants: [
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter()).map(([color]) => ({
				props: { color },
				style: { [`&.${outlinedInputClasses.focused} .${outlinedInputClasses.notchedOutline}`]: { borderColor: (theme.vars || theme).palette[color].main } }
			})),
			{
				props: {},
				style: {
					[`&.${outlinedInputClasses.error} .${outlinedInputClasses.notchedOutline}`]: { borderColor: (theme.vars || theme).palette.error.main },
					[`&.${outlinedInputClasses.disabled} .${outlinedInputClasses.notchedOutline}`]: { borderColor: (theme.vars || theme).palette.action.disabled }
				}
			},
			{
				props: ({ ownerState }) => ownerState.startAdornment,
				style: { paddingLeft: 14 }
			},
			{
				props: ({ ownerState }) => ownerState.endAdornment,
				style: { paddingRight: 14 }
			},
			{
				props: ({ ownerState }) => ownerState.multiline,
				style: { padding: "16.5px 14px" }
			},
			{
				props: ({ ownerState, size }) => ownerState.multiline && size === "small",
				style: { padding: "8.5px 14px" }
			}
		]
	};
}));
var NotchedOutlineRoot = styled(NotchedOutline, {
	name: "MuiOutlinedInput",
	slot: "NotchedOutline"
})(memoTheme(({ theme }) => {
	const borderColor = theme.palette.mode === "light" ? "rgba(0, 0, 0, 0.23)" : "rgba(255, 255, 255, 0.23)";
	return { borderColor: theme.vars ? theme.alpha(theme.vars.palette.common.onBackground, .23) : borderColor };
}));
var OutlinedInputInput = styled(InputBaseInput, {
	name: "MuiOutlinedInput",
	slot: "Input",
	overridesResolver: inputOverridesResolver
})(memoTheme(({ theme }) => ({
	padding: "16.5px 14px",
	"&:-webkit-autofill": {
		...!theme.vars && {
			WebkitBoxShadow: theme.palette.mode === "light" ? null : "0 0 0 100px #266798 inset",
			WebkitTextFillColor: theme.palette.mode === "light" ? null : "#fff",
			caretColor: theme.palette.mode === "light" ? null : "#fff"
		},
		borderRadius: "inherit",
		...theme.vars && theme.applyStyles("dark", {
			WebkitBoxShadow: "0 0 0 100px #266798 inset",
			WebkitTextFillColor: "#fff",
			caretColor: "#fff"
		})
	},
	variants: [
		{
			props: { size: "small" },
			style: { padding: "8.5px 14px" }
		},
		{
			props: ({ ownerState }) => ownerState.multiline,
			style: { padding: 0 }
		},
		{
			props: ({ ownerState }) => ownerState.startAdornment,
			style: { paddingLeft: 0 }
		},
		{
			props: ({ ownerState }) => ownerState.endAdornment,
			style: { paddingRight: 0 }
		}
	]
})));
var OutlinedInput = /* @__PURE__ */ import_react.forwardRef(function OutlinedInput(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiOutlinedInput"
	});
	const { fullWidth = false, inputComponent = "input", label, multiline = false, notched, slots = {}, slotProps = {}, type = "text", ...other } = props;
	const classes = useUtilityClasses$3(props);
	const [fcs, muiFormControl] = useFormControlState({
		props,
		states: [
			"color",
			"disabled",
			"error",
			"focused",
			"hiddenLabel",
			"size",
			"required"
		]
	});
	const ownerState = {
		...props,
		color: fcs.color || "primary",
		disabled: fcs.disabled,
		error: fcs.error,
		focused: fcs.focused,
		formControl: muiFormControl,
		fullWidth,
		hiddenLabel: fcs.hiddenLabel,
		multiline,
		size: fcs.size,
		type
	};
	const RootSlot = slots.root ?? OutlinedInputRoot;
	const InputSlot = slots.input ?? OutlinedInputInput;
	const [NotchedSlot, notchedProps] = useSlot("notchedOutline", {
		elementType: NotchedOutlineRoot,
		className: classes.notchedOutline,
		shouldForwardComponentProp: true,
		ownerState,
		externalForwardedProps: {
			slots,
			slotProps
		},
		additionalProps: { label: label != null && label !== "" && fcs.required ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [
			label,
			" ",
			"*"
		] }) : label }
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputBase, {
		slots: {
			root: RootSlot,
			input: InputSlot
		},
		slotProps,
		renderSuffix: (state) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NotchedSlot, {
			...notchedProps,
			notched: typeof notched !== "undefined" ? notched : Boolean(state.startAdornment || state.filled || state.focused)
		}),
		fullWidth,
		inputComponent,
		multiline,
		ref,
		type,
		...other,
		classes: {
			...classes,
			notchedOutline: null
		}
	});
});
OutlinedInput.propTypes = {
	autoComplete: import_prop_types.default.string,
	autoFocus: import_prop_types.default.bool,
	classes: import_prop_types.default.object,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["primary", "secondary"]), import_prop_types.default.string]),
	defaultValue: import_prop_types.default.any,
	disabled: import_prop_types.default.bool,
	endAdornment: import_prop_types.default.node,
	error: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	id: import_prop_types.default.string,
	inputComponent: import_prop_types.default.elementType,
	inputProps: import_prop_types.default.object,
	inputRef: refType,
	label: import_prop_types.default.node,
	margin: import_prop_types.default.oneOf(["dense", "none"]),
	maxRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	minRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	multiline: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	notched: import_prop_types.default.bool,
	onChange: import_prop_types.default.func,
	placeholder: import_prop_types.default.string,
	readOnly: import_prop_types.default.bool,
	required: import_prop_types.default.bool,
	rows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	slotProps: import_prop_types.default.shape({
		input: import_prop_types.default.object,
		notchedOutline: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		root: import_prop_types.default.object
	}),
	slots: import_prop_types.default.shape({
		input: import_prop_types.default.elementType,
		notchedOutline: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType
	}),
	startAdornment: import_prop_types.default.node,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	type: import_prop_types.default.string,
	value: import_prop_types.default.any
};
OutlinedInput.muiName = "Input";
//#endregion
//#region frontend/node_modules/@mui/material/Select/selectClasses.mjs
function getSelectUtilityClasses(slot) {
	return generateUtilityClass("MuiSelect", slot);
}
var selectClasses = generateUtilityClasses("MuiSelect", [
	"root",
	"select",
	"multiple",
	"filled",
	"outlined",
	"standard",
	"disabled",
	"focused",
	"icon",
	"iconOpen",
	"nativeInput",
	"error"
]);
//#endregion
//#region frontend/node_modules/@mui/material/Select/utils/closedTypeahead.mjs
function hasOwnValueProp(child) {
	return Object.prototype.hasOwnProperty.call(child.props, "value");
}
function getTextFromReactNode(node) {
	if (typeof node === "string" || typeof node === "number") return String(node);
	let text = "";
	import_react.Children.forEach(node, (child) => {
		if (typeof child === "string" || typeof child === "number") text += String(child);
		else if (/* @__PURE__ */ import_react.isValidElement(child)) text += getTextFromReactNode(child.props.children);
	});
	return text;
}
function getMatchingOptionIndex(options, search, startIndex = 0) {
	if (options.length === 0) return -1;
	const normalizedStartIndex = (startIndex % options.length + options.length) % options.length;
	for (let offset = 0; offset < options.length; offset += 1) {
		const index = (normalizedStartIndex + offset) % options.length;
		if (options[index].label.startsWith(search)) return index;
	}
	return -1;
}
function canCycleRepeatedCharacter(options, key) {
	return !options.some((option) => option.label[0] === key && option.label[1] === key);
}
function getTypeaheadOptions(childrenArray, value) {
	const options = [];
	let selectedIndex = -1;
	for (let index = 0; index < childrenArray.length; index += 1) {
		const child = childrenArray[index];
		if (!/* @__PURE__ */ import_react.isValidElement(child) || !hasOwnValueProp(child) || child.props.disabled) continue;
		const label = getTextFromReactNode(child.props.children).trim().toLowerCase();
		if (label === "") continue;
		if (selectedIndex === -1 && areEqualValues(value, child.props.value)) selectedIndex = options.length;
		options.push({
			child,
			label,
			value: child.props.value
		});
	}
	return {
		options,
		selectedIndex
	};
}
//#endregion
//#region frontend/node_modules/@mui/material/Select/SelectInput.mjs
var import_react_is = require_react_is();
var _span;
var OPENING_MOUSE_UP_BOUNDARY_OFFSET = 2;
var SELECTED_MOUSE_UP_DELAY = 400;
var UNSELECTED_MOUSE_UP_DELAY = 200;
var TYPEAHEAD_RESET_MS = 750;
var SPACE = " ";
var ARROW_UP = "ArrowUp";
var ARROW_DOWN = "ArrowDown";
var ENTER = "Enter";
/**
* Returns true when a native mouse event should be treated as happening inside
* the element, even if a portal or backdrop retargeted the event away from it.
*
* Select uses this for the opening mouseup: when the menu opens over the
* trigger, the release can target the backdrop or portaled menu even though the
* pointer is still inside the trigger or menu bounds.
*/
function isMouseEventInsideElement(event, element) {
	if (!element) return false;
	if (event.composedPath().includes(element)) return true;
	if (event.target?.nodeType && element.contains(event.target)) return true;
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return false;
	return event.clientX >= rect.left - OPENING_MOUSE_UP_BOUNDARY_OFFSET && event.clientX <= rect.right + OPENING_MOUSE_UP_BOUNDARY_OFFSET && event.clientY >= rect.top - OPENING_MOUSE_UP_BOUNDARY_OFFSET && event.clientY <= rect.bottom + OPENING_MOUSE_UP_BOUNDARY_OFFSET;
}
var SelectSelect = styled(StyledSelectSelect, {
	name: "MuiSelect",
	slot: "Select",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			{ [`&.${selectClasses.select}`]: styles.select },
			{ [`&.${selectClasses.select}`]: styles[ownerState.variant] },
			{ [`&.${selectClasses.error}`]: styles.error },
			{ [`&.${selectClasses.multiple}`]: styles.multiple }
		];
	}
})({ [`&.${selectClasses.select}`]: {
	height: "auto",
	minHeight: "1.4375em",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	overflow: "hidden"
} });
var SelectIcon = styled(StyledSelectIcon, {
	name: "MuiSelect",
	slot: "Icon",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [styles.icon, ownerState.open && styles.iconOpen];
	}
})({});
var SelectNativeInput = styled("input", {
	shouldForwardProp: (prop) => slotShouldForwardProp(prop) && prop !== "classes",
	name: "MuiSelect",
	slot: "NativeInput"
})({
	bottom: 0,
	left: 0,
	position: "absolute",
	opacity: 0,
	pointerEvents: "none",
	width: "100%",
	boxSizing: "border-box"
});
var useUtilityClasses$2 = (ownerState) => {
	const { classes, variant, disabled, multiple, open, error } = ownerState;
	return composeClasses({
		select: [
			"select",
			variant,
			disabled && "disabled",
			multiple && "multiple",
			error && "error"
		],
		icon: [
			"icon",
			open && "iconOpen",
			disabled && "disabled"
		],
		nativeInput: ["nativeInput"]
	}, getSelectUtilityClasses, classes);
};
/**
* @ignore - internal component.
*/
var SelectInput = /* @__PURE__ */ import_react.forwardRef(function SelectInput(props, ref) {
	const { "aria-describedby": ariaDescribedby, "aria-label": ariaLabel, autoFocus, autoWidth, children, className, defaultOpen, defaultValue, disabled, displayEmpty, error = false, IconComponent, inputRef: inputRefProp, labelId, MenuProps = {}, multiple, name, onBlur, onChange, onClose, onFocus, onKeyDown, onMouseDown, onOpen, open: openProp, readOnly, renderValue, required, SelectDisplayProps = {}, tabIndex: tabIndexProp, type, value: valueProp, variant = "standard", ...other } = props;
	const [value, setValueState] = useControlled_default({
		controlled: valueProp,
		default: defaultValue,
		name: "Select"
	});
	const [openState, setOpenState] = useControlled_default({
		controlled: openProp,
		default: defaultOpen,
		name: "Select"
	});
	const inputRef = import_react.useRef(null);
	const displayRef = import_react.useRef(null);
	const paperRef = import_react.useRef(null);
	const openRef = import_react.useRef(false);
	const hasSelectedItemInListRef = import_react.useRef(false);
	const openingMouseUpListenerCleanupRef = import_react.useRef(null);
	const didPointerDownOnItemRef = import_react.useRef(false);
	const selectionRef = import_react.useRef({
		allowSelectedMouseUp: false,
		allowUnselectedMouseUp: false
	});
	const closedTypeaheadRef = import_react.useRef({
		buffer: "",
		previousSearchIndex: null,
		matchedIndex: null
	});
	const selectedMouseUpTimer = useTimeout();
	const unselectedMouseUpTimer = useTimeout();
	const typeaheadResetTimer = useTimeout();
	const [displayNode, setDisplayNode] = import_react.useState(null);
	const { current: isOpenControlled } = import_react.useRef(openProp != null);
	const [menuMinWidthState, setMenuMinWidthState] = import_react.useState();
	const [openInteractionType, setOpenInteractionType] = import_react.useState(null);
	const handleRef = useForkRef_default(ref, inputRefProp);
	const handleDisplayRef = import_react.useCallback((node) => {
		displayRef.current = node;
		if (node) setDisplayNode(node);
	}, []);
	const anchorElement = displayNode?.parentNode;
	import_react.useImperativeHandle(handleRef, () => ({
		focus: () => {
			displayRef.current.focus();
		},
		node: inputRef.current,
		value
	}), [value]);
	const open = displayNode !== null && openState;
	const resetClosedTypeahead = import_react.useCallback(() => {
		typeaheadResetTimer.clear();
		closedTypeaheadRef.current.buffer = "";
		closedTypeaheadRef.current.previousSearchIndex = null;
		closedTypeaheadRef.current.matchedIndex = null;
	}, [typeaheadResetTimer]);
	useEnhancedEffect_default(() => {
		openRef.current = open;
		if (open) resetClosedTypeahead();
	}, [open, resetClosedTypeahead]);
	const clearSelectionTimers = import_react.useCallback(() => {
		selectedMouseUpTimer.clear();
		unselectedMouseUpTimer.clear();
	}, [selectedMouseUpTimer, unselectedMouseUpTimer]);
	const resetMouseUpSelection = import_react.useCallback(() => {
		clearSelectionTimers();
		didPointerDownOnItemRef.current = false;
		selectionRef.current = {
			allowSelectedMouseUp: false,
			allowUnselectedMouseUp: false
		};
	}, [clearSelectionTimers]);
	const clearOpeningMouseUpListener = import_react.useCallback(() => {
		if (openingMouseUpListenerCleanupRef.current) {
			openingMouseUpListenerCleanupRef.current();
			openingMouseUpListenerCleanupRef.current = null;
		}
	}, []);
	import_react.useEffect(() => {
		if (!open) {
			resetMouseUpSelection();
			clearOpeningMouseUpListener();
		}
	}, [
		open,
		resetMouseUpSelection,
		clearOpeningMouseUpListener
	]);
	import_react.useEffect(() => {
		return () => {
			resetMouseUpSelection();
			clearOpeningMouseUpListener();
			resetClosedTypeahead();
		};
	}, [
		resetMouseUpSelection,
		clearOpeningMouseUpListener,
		resetClosedTypeahead
	]);
	import_react.useEffect(() => {
		if (!open || !anchorElement || autoWidth) return;
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			setMenuMinWidthState(anchorElement.clientWidth);
		});
		observer.observe(anchorElement);
		return () => {
			observer.disconnect();
		};
	}, [
		open,
		anchorElement,
		autoWidth
	]);
	import_react.useEffect(() => {
		if (defaultOpen && openState && displayNode && !isOpenControlled) {
			setMenuMinWidthState(autoWidth ? null : anchorElement.clientWidth);
			displayRef.current.focus();
		}
	}, [displayNode, autoWidth]);
	import_react.useEffect(() => {
		if (autoFocus) displayRef.current.focus();
	}, [autoFocus]);
	import_react.useEffect(() => {
		if (!labelId) return;
		const label = ownerDocument_default(displayRef.current).getElementById(labelId);
		if (label) {
			const handler = () => {
				if (getSelection().isCollapsed) displayRef.current.focus();
			};
			label.addEventListener("click", handler);
			return () => {
				label.removeEventListener("click", handler);
			};
		}
	}, [labelId]);
	const update = useEventCallback_default((openParam, event) => {
		if (!openParam) {
			resetMouseUpSelection();
			clearOpeningMouseUpListener();
		}
		if (openParam) {
			resetClosedTypeahead();
			setOpenInteractionType(getOpenInteractionType(event));
			if (onOpen) onOpen(event);
		} else {
			setOpenInteractionType(null);
			if (onClose) onClose(event);
		}
		if (!isOpenControlled) {
			openRef.current = openParam;
			setMenuMinWidthState(autoWidth ? null : anchorElement.clientWidth);
			setOpenState(openParam);
		}
	});
	const scheduleMouseUpSelection = () => {
		resetMouseUpSelection();
		if (!hasSelectedItemInListRef.current) selectedMouseUpTimer.start(SELECTED_MOUSE_UP_DELAY, () => {
			selectionRef.current.allowSelectedMouseUp = true;
			selectionRef.current.allowUnselectedMouseUp = true;
		});
		else unselectedMouseUpTimer.start(UNSELECTED_MOUSE_UP_DELAY, () => {
			selectionRef.current.allowUnselectedMouseUp = true;
			selectedMouseUpTimer.start(UNSELECTED_MOUSE_UP_DELAY, () => {
				selectionRef.current.allowSelectedMouseUp = true;
			});
		});
	};
	const handleMouseDown = (event) => {
		onMouseDown?.(event);
		if (event.button !== 0) return;
		event.preventDefault();
		if (!displayRef.current) return;
		displayRef.current.focus();
		const doc = ownerDocument_default(event.currentTarget);
		scheduleMouseUpSelection();
		clearOpeningMouseUpListener();
		const handleMouseUp = (mouseEvent) => {
			openingMouseUpListenerCleanupRef.current = null;
			if (!displayRef.current) return;
			if (isMouseEventInsideElement(mouseEvent, displayRef.current) || isMouseEventInsideElement(mouseEvent, paperRef.current)) return;
			if (!openRef.current && isOpenControlled) return;
			update(false, mouseEvent);
		};
		doc.addEventListener("mouseup", handleMouseUp, {
			capture: true,
			once: true
		});
		openingMouseUpListenerCleanupRef.current = () => {
			doc.removeEventListener("mouseup", handleMouseUp, true);
		};
		update(true, event);
	};
	const handleClose = (event) => {
		update(false, event);
	};
	const childrenArray = import_react.Children.toArray(children);
	const handleChange = (event) => {
		const child = childrenArray.find((childItem) => childItem.props.value === event.target.value);
		if (child === void 0) return;
		setValueState(child.props.value);
		if (onChange) onChange(event, child);
	};
	const handleValueChange = (event, child, newValue) => {
		setValueState(newValue);
		if (onChange) {
			const nativeEvent = event.nativeEvent || event;
			const clonedEvent = new nativeEvent.constructor(nativeEvent.type, nativeEvent);
			Object.defineProperty(clonedEvent, "target", {
				writable: true,
				value: {
					value: newValue,
					name
				}
			});
			onChange(clonedEvent, child);
		}
	};
	const handleItemClick = (child) => (event) => {
		didPointerDownOnItemRef.current = false;
		let newValue;
		if (!event.currentTarget.hasAttribute("tabindex")) return;
		if (multiple) {
			newValue = Array.isArray(value) ? value.slice() : [];
			const itemIndex = value.indexOf(child.props.value);
			if (itemIndex === -1) newValue.push(child.props.value);
			else newValue.splice(itemIndex, 1);
		} else newValue = child.props.value;
		if (child.props.onClick) child.props.onClick(event);
		if (value !== newValue) handleValueChange(event, child, newValue);
		if (!multiple) update(false, event);
	};
	const handleItemMouseUp = (child, selected) => (event) => {
		child.props.onMouseUp?.(event);
		if (didPointerDownOnItemRef.current) {
			didPointerDownOnItemRef.current = false;
			return;
		}
		const disallowSelectedMouseUp = !selectionRef.current.allowSelectedMouseUp && selected;
		const disallowUnselectedMouseUp = !selectionRef.current.allowUnselectedMouseUp && !selected;
		if (disallowSelectedMouseUp || disallowUnselectedMouseUp) return;
		event.currentTarget.click();
	};
	const handleClosedTypeahead = (event) => {
		const state = closedTypeaheadRef.current;
		const hasActiveBuffer = state.buffer !== "";
		if (open || multiple || disabled || event.defaultPrevented || event.nativeEvent?.isComposing || event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === SPACE && !hasActiveBuffer) return false;
		if (event.key === SPACE) event.preventDefault();
		const isNewSession = state.buffer === "";
		const { options: searchableOptions, selectedIndex } = getTypeaheadOptions(childrenArray, value);
		if (searchableOptions.length === 0) {
			if (event.key !== SPACE) resetClosedTypeahead();
			return true;
		}
		if (isNewSession) state.previousSearchIndex = selectedIndex;
		const key = event.key.toLowerCase();
		if (state.buffer === key && canCycleRepeatedCharacter(searchableOptions, key)) {
			state.buffer = "";
			state.previousSearchIndex = state.matchedIndex;
		}
		state.buffer += key;
		typeaheadResetTimer.start(TYPEAHEAD_RESET_MS, resetClosedTypeahead);
		const matchingIndex = getMatchingOptionIndex(searchableOptions, state.buffer, (state.previousSearchIndex ?? -1) + 1);
		if (matchingIndex !== -1) {
			const matchedOption = searchableOptions[matchingIndex];
			state.matchedIndex = matchingIndex;
			if (!areEqualValues(value, matchedOption.value)) handleValueChange(event, matchedOption.child, matchedOption.value);
			return true;
		}
		if (event.key !== SPACE) resetClosedTypeahead();
		return true;
	};
	const handleKeyDown = (event) => {
		if (!readOnly) {
			const isClosedTypeaheadHandled = handleClosedTypeahead(event);
			const isOpenKey = event.key === SPACE || event.key === ARROW_UP || event.key === ARROW_DOWN || event.key === ENTER;
			if (!isClosedTypeaheadHandled && isOpenKey) {
				event.preventDefault();
				update(true, event);
			}
			onKeyDown?.(event);
		}
	};
	const handleBlur = (event) => {
		resetClosedTypeahead();
		if (!open && onBlur) {
			Object.defineProperty(event, "target", {
				writable: true,
				value: {
					value,
					name
				}
			});
			onBlur(event);
		}
	};
	const handleItemKeyDown = (child) => (event) => {
		child?.props?.onKeyDown?.(event);
		if (event.key === SPACE && event.target === event.currentTarget && !event.defaultPrevented) {
			event.preventDefault();
			if (!event.repeat) event.currentTarget.click();
		}
	};
	delete other["aria-invalid"];
	let display;
	let displaySingle;
	const displayMultiple = [];
	let computeDisplay = false;
	let foundMatch = false;
	if (isFilled({ value }) || displayEmpty) if (renderValue) display = renderValue(value);
	else computeDisplay = true;
	const items = childrenArray.map((child) => {
		if (!/* @__PURE__ */ import_react.isValidElement(child)) return null;
		if ((0, import_react_is.isFragment)(child)) console.error(["MUI: The Select component doesn't accept a Fragment as a child.", "Consider providing an array instead."].join("\n"));
		let selected;
		if (multiple) {
			if (!Array.isArray(value)) throw new Error("MUI: The `value` prop must be an array when using the `Select` component with `multiple`.");
			selected = value.some((v) => areEqualValues(v, child.props.value));
			if (selected && computeDisplay) displayMultiple.push(child.props.children);
		} else {
			selected = areEqualValues(value, child.props.value);
			if (selected && computeDisplay) displaySingle = child.props.children;
		}
		if (selected) foundMatch = true;
		return /* @__PURE__ */ import_react.cloneElement(child, {
			"aria-selected": selected ? "true" : "false",
			onMouseDown: (event) => {
				didPointerDownOnItemRef.current = true;
				child.props.onMouseDown?.(event);
			},
			onPointerDown: (event) => {
				didPointerDownOnItemRef.current = true;
				child.props.onPointerDown?.(event);
			},
			onClick: handleItemClick(child),
			onMouseUp: handleItemMouseUp(child, selected),
			onKeyUp: (event) => {
				if (event.key === SPACE) event.preventDefault();
				if (child.props.onKeyUp) child.props.onKeyUp(event);
			},
			onKeyDown: handleItemKeyDown(child),
			role: "option",
			selected,
			value: void 0,
			"data-value": child.props.value
		});
	});
	useEnhancedEffect_default(() => {
		hasSelectedItemInListRef.current = foundMatch;
		if (!open && !multiple && !foundMatch) resetClosedTypeahead();
	}, [
		foundMatch,
		multiple,
		open,
		resetClosedTypeahead
	]);
	import_react.useEffect(() => {
		if (!foundMatch && !multiple && value !== "") {
			const values = childrenArray.map((child) => child.props.value);
			console.warn([
				`MUI: You have provided an out-of-range value \`${value}\` for the select ${name ? `(name="${name}") ` : ""}component.`,
				"Consider providing a value that matches one of the available options or ''.",
				`The available values are ${values.filter((x) => x != null).map((x) => `\`${x}\``).join(", ") || "\"\""}.`
			].join("\n"));
		}
	}, [
		foundMatch,
		childrenArray,
		multiple,
		name,
		value
	]);
	if (computeDisplay) if (multiple) if (displayMultiple.length === 0) display = null;
	else display = displayMultiple.reduce((output, child, index) => {
		output.push(child);
		if (index < displayMultiple.length - 1) output.push(", ");
		return output;
	}, []);
	else display = displaySingle;
	let menuMinWidth = menuMinWidthState;
	if (!autoWidth && isOpenControlled && displayNode) menuMinWidth = anchorElement.clientWidth;
	let tabIndex;
	if (typeof tabIndexProp !== "undefined") tabIndex = tabIndexProp;
	else tabIndex = disabled ? null : 0;
	const buttonId = SelectDisplayProps.id || (name ? `mui-component-select-${name}` : void 0);
	const ownerState = {
		...props,
		variant,
		value,
		open,
		error
	};
	const classes = useUtilityClasses$2(ownerState);
	const menuPaperSlotProps = typeof MenuProps.slotProps?.paper === "function" ? MenuProps.slotProps.paper(ownerState) : MenuProps.slotProps?.paper;
	const handlePaperRef = useForkRef_default(menuPaperSlotProps?.ref, paperRef);
	const menuListSlotProps = typeof MenuProps.slotProps?.list === "function" ? MenuProps.slotProps.list(ownerState) : MenuProps.slotProps?.list;
	const listboxId = useId();
	const nativeInputId = useId();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectSelect, {
			as: "div",
			ref: handleDisplayRef,
			tabIndex,
			role: "combobox",
			"aria-controls": open ? listboxId : void 0,
			"aria-disabled": disabled ? "true" : void 0,
			"aria-expanded": open ? "true" : "false",
			"aria-haspopup": "listbox",
			"aria-readonly": readOnly ? "true" : void 0,
			"aria-label": ariaLabel,
			"aria-labelledby": labelId,
			"aria-describedby": ariaDescribedby,
			"aria-required": required ? "true" : void 0,
			"aria-invalid": error ? "true" : void 0,
			onKeyDown: handleKeyDown,
			onMouseDown: disabled || readOnly ? null : handleMouseDown,
			onBlur: handleBlur,
			onFocus,
			...SelectDisplayProps,
			ownerState,
			className: clsx(SelectDisplayProps.className, classes.select, className),
			id: buttonId,
			children: isEmpty(display) ? _span || (_span = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "notranslate",
				"aria-hidden": true,
				children: "​"
			})) : display
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectNativeInput, {
			"aria-invalid": error,
			value: Array.isArray(value) ? value.join(",") : value,
			name,
			ref: inputRef,
			"aria-hidden": true,
			onChange: handleChange,
			tabIndex: -1,
			disabled,
			readOnly,
			className: classes.nativeInput,
			autoFocus,
			required,
			...other,
			id: other.id ?? nativeInputId,
			ownerState
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectIcon, {
			as: IconComponent,
			className: classes.icon,
			ownerState
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectFocusSourceProvider, {
			value: openInteractionType,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, {
				id: `menu-${name || ""}`,
				anchorEl: anchorElement,
				open,
				onClose: handleClose,
				anchorOrigin: {
					vertical: "bottom",
					horizontal: "center"
				},
				transformOrigin: {
					vertical: "top",
					horizontal: "center"
				},
				...MenuProps,
				slotProps: {
					...MenuProps.slotProps,
					list: {
						"aria-labelledby": labelId,
						role: "listbox",
						"aria-multiselectable": multiple ? "true" : void 0,
						disableListWrap: true,
						id: listboxId,
						...menuListSlotProps
					},
					paper: {
						...menuPaperSlotProps,
						ref: handlePaperRef,
						style: {
							minWidth: menuMinWidth,
							...menuPaperSlotProps?.style
						}
					}
				},
				children: items
			})
		})
	] });
});
SelectInput.propTypes = {
	"aria-describedby": import_prop_types.default.string,
	"aria-label": import_prop_types.default.string,
	autoFocus: import_prop_types.default.bool,
	autoWidth: import_prop_types.default.bool,
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	defaultOpen: import_prop_types.default.bool,
	defaultValue: import_prop_types.default.any,
	disabled: import_prop_types.default.bool,
	displayEmpty: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	IconComponent: import_prop_types.default.elementType.isRequired,
	inputRef: refType,
	labelId: import_prop_types.default.string,
	MenuProps: import_prop_types.default.object,
	multiple: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	onBlur: import_prop_types.default.func,
	onChange: import_prop_types.default.func,
	onClose: import_prop_types.default.func,
	onFocus: import_prop_types.default.func,
	onOpen: import_prop_types.default.func,
	open: import_prop_types.default.bool,
	readOnly: import_prop_types.default.bool,
	renderValue: import_prop_types.default.func,
	required: import_prop_types.default.bool,
	SelectDisplayProps: import_prop_types.default.object,
	tabIndex: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	type: import_prop_types.default.any,
	value: import_prop_types.default.any,
	variant: import_prop_types.default.oneOf([
		"standard",
		"outlined",
		"filled"
	])
};
//#endregion
//#region frontend/node_modules/@mui/material/Select/Select.mjs
var useUtilityClasses$1 = (ownerState) => {
	const { classes } = ownerState;
	const composedClasses = composeClasses({ root: ["root"] }, getSelectUtilityClasses, classes);
	return {
		...classes,
		...composedClasses
	};
};
var styledRootConfig = {
	name: "MuiSelect",
	slot: "Root",
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) && prop !== "variant"
};
var StyledInput = styled(Input, styledRootConfig)("");
var StyledOutlinedInput = styled(OutlinedInput, styledRootConfig)("");
var StyledFilledInput = styled(FilledInput, styledRootConfig)("");
var Select = /* @__PURE__ */ import_react.forwardRef(function Select(inProps, ref) {
	const props = useDefaultProps({
		name: "MuiSelect",
		props: inProps
	});
	const { autoWidth = false, children, classes: classesProp = {}, className, defaultOpen = false, displayEmpty = false, IconComponent = ArrowDropDown_default, id, input, inputProps, label, labelId, MenuProps, multiple = false, native = false, onClose, onOpen, open, renderValue, SelectDisplayProps, variant: variantProp = "outlined", ...other } = props;
	const inputComponent = native ? NativeSelectInput : SelectInput;
	const [fcs] = useFormControlState({
		props,
		states: ["variant", "error"]
	});
	const variant = fcs.variant || variantProp;
	const ownerState = {
		...props,
		variant,
		classes: classesProp
	};
	const classes = useUtilityClasses$1(ownerState);
	const { root, ...restOfClasses } = classes;
	const InputComponent = input || {
		standard: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StyledInput, { ownerState }),
		outlined: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StyledOutlinedInput, {
			label,
			ownerState
		}),
		filled: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StyledFilledInput, { ownerState })
	}[variant];
	const inputComponentRef = useForkRef_default(ref, getReactElementRef(InputComponent));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Fragment, { children: /* @__PURE__ */ import_react.cloneElement(InputComponent, {
		inputComponent,
		inputProps: {
			children,
			error: fcs.error,
			IconComponent,
			variant,
			type: void 0,
			multiple,
			...native ? { id } : {
				autoWidth,
				defaultOpen,
				displayEmpty,
				labelId,
				MenuProps,
				onClose,
				onOpen,
				open,
				renderValue,
				SelectDisplayProps: {
					id,
					...SelectDisplayProps
				}
			},
			...inputProps,
			classes: inputProps ? deepmerge(restOfClasses, inputProps.classes) : restOfClasses,
			...input ? input.props.inputProps : {}
		},
		...(multiple && native || displayEmpty) && variant === "outlined" ? { notched: true } : {},
		ref: inputComponentRef,
		className: clsx(InputComponent.props.className, className, classes.root),
		...!input && { variant },
		...other
	}) });
});
Select.propTypes = {
	autoWidth: import_prop_types.default.bool,
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	defaultOpen: import_prop_types.default.bool,
	defaultValue: import_prop_types.default.any,
	displayEmpty: import_prop_types.default.bool,
	IconComponent: import_prop_types.default.elementType,
	id: import_prop_types.default.string,
	input: import_prop_types.default.element,
	inputProps: import_prop_types.default.object,
	label: import_prop_types.default.node,
	labelId: import_prop_types.default.string,
	MenuProps: import_prop_types.default.object,
	multiple: import_prop_types.default.bool,
	native: import_prop_types.default.bool,
	onChange: import_prop_types.default.func,
	onClose: import_prop_types.default.func,
	onOpen: import_prop_types.default.func,
	open: import_prop_types.default.bool,
	renderValue: import_prop_types.default.func,
	SelectDisplayProps: import_prop_types.default.object,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	value: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([""]), import_prop_types.default.any]),
	variant: import_prop_types.default.oneOf([
		"filled",
		"outlined",
		"standard"
	])
};
Select.muiName = "Select";
//#endregion
//#region frontend/node_modules/@mui/material/TextField/textFieldClasses.mjs
function getTextFieldUtilityClass(slot) {
	return generateUtilityClass("MuiTextField", slot);
}
var textFieldClasses = generateUtilityClasses("MuiTextField", ["root"]);
//#endregion
//#region frontend/node_modules/@mui/material/TextField/TextField.mjs
var variantComponent = {
	standard: Input,
	filled: FilledInput,
	outlined: OutlinedInput
};
var useUtilityClasses = (ownerState) => {
	const { classes } = ownerState;
	return composeClasses({ root: ["root"] }, getTextFieldUtilityClass, classes);
};
var TextFieldRoot = styled(FormControl, {
	name: "MuiTextField",
	slot: "Root"
})({});
/**
* The `TextField` is a convenience wrapper for the most common cases (80%).
* It cannot be all things to all people, otherwise the API would grow out of control.
*
* ## Advanced Configuration
*
* It's important to understand that the text field is a simple abstraction
* on top of the following components:
*
* - [FormControl](/material-ui/api/form-control/)
* - [InputLabel](/material-ui/api/input-label/)
* - [FilledInput](/material-ui/api/filled-input/)
* - [OutlinedInput](/material-ui/api/outlined-input/)
* - [Input](/material-ui/api/input/)
* - [FormHelperText](/material-ui/api/form-helper-text/)
*
* If you wish to alter the props applied to the `input` element, you can do so as follows:
*
* ```jsx
* const slotProps = {
*   htmlInput: {
*      step: 300
*   }
* };
*
* return <TextField id="time" type="time" slotProps={slotProps} />;
* ```
*
* For advanced cases, please look at the source of TextField by clicking on the
* "Edit this page" button above. Consider either:
*
* - using the `slotProps` prop for passing values directly to the components
* - using the underlying components directly as shown in the demos
*/
var TextField = /* @__PURE__ */ import_react.forwardRef(function TextField(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiTextField"
	});
	const { autoComplete, autoFocus = false, children, className, color = "primary", defaultValue, disabled = false, error = false, fullWidth = false, helperText, id: idOverride, inputRef, label, maxRows, minRows, multiline = false, name, onBlur, onChange, onFocus, placeholder, required = false, rows, select = false, slots = {}, slotProps = {}, type, value, variant = "outlined", ...other } = props;
	const ownerState = {
		...props,
		autoFocus,
		color,
		disabled,
		error,
		fullWidth,
		multiline,
		required,
		select,
		variant
	};
	const classes = useUtilityClasses(ownerState);
	if (select && !children) console.error("MUI: `children` must be passed when using the `TextField` component with `select`.");
	const id = useId(idOverride);
	const helperTextId = helperText && id ? `${id}-helper-text` : void 0;
	const inputLabelId = label && id ? `${id}-label` : void 0;
	const InputComponent = variantComponent[variant];
	const externalForwardedProps = {
		slots,
		slotProps
	};
	const [SelectSlot, selectProps] = useSlot("select", {
		elementType: Select,
		externalForwardedProps,
		ownerState
	});
	const nativeSelect = select && selectProps.native;
	const inputAdditionalProps = {};
	const inputLabelSlotProps = externalForwardedProps.slotProps.inputLabel;
	if (variant === "outlined") {
		if (inputLabelSlotProps && typeof inputLabelSlotProps.shrink !== "undefined") inputAdditionalProps.notched = inputLabelSlotProps.shrink;
		inputAdditionalProps.label = label;
	}
	if (select) {
		if (!nativeSelect) inputAdditionalProps.id = void 0;
		inputAdditionalProps["aria-describedby"] = void 0;
	}
	const [RootSlot, rootProps] = useSlot("root", {
		elementType: TextFieldRoot,
		shouldForwardComponentProp: true,
		externalForwardedProps: {
			...externalForwardedProps,
			...other
		},
		ownerState,
		className: clsx(classes.root, className),
		ref,
		additionalProps: {
			disabled,
			error,
			fullWidth,
			required,
			color,
			variant
		}
	});
	const [InputSlot, inputProps] = useSlot("input", {
		elementType: InputComponent,
		externalForwardedProps,
		additionalProps: inputAdditionalProps,
		ownerState
	});
	const [InputLabelSlot, inputLabelProps] = useSlot("inputLabel", {
		elementType: InputLabel,
		externalForwardedProps,
		ownerState
	});
	const [HtmlInputSlot, htmlInputProps] = useSlot("htmlInput", {
		elementType: "input",
		externalForwardedProps,
		ownerState
	});
	const [FormHelperTextSlot, formHelperTextProps] = useSlot("formHelperText", {
		elementType: FormHelperText,
		externalForwardedProps,
		ownerState
	});
	const InputElement = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputSlot, {
		"aria-describedby": helperTextId,
		autoComplete,
		autoFocus,
		defaultValue,
		fullWidth,
		multiline,
		name,
		rows,
		maxRows,
		minRows,
		type,
		value,
		id,
		inputRef,
		onBlur,
		onChange,
		onFocus,
		placeholder,
		inputProps: htmlInputProps,
		slots: { input: slots.htmlInput ? HtmlInputSlot : void 0 },
		...inputProps
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(RootSlot, {
		...rootProps,
		children: [
			label != null && label !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InputLabelSlot, {
				htmlFor: select && !nativeSelect ? void 0 : id,
				id: inputLabelId,
				...select && !nativeSelect && { component: "div" },
				...inputLabelProps,
				children: label
			}),
			select ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SelectSlot, {
				"aria-describedby": helperTextId,
				id,
				labelId: inputLabelId,
				value,
				input: InputElement,
				...selectProps,
				children
			}) : InputElement,
			helperText && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormHelperTextSlot, {
				id: helperTextId,
				...formHelperTextProps,
				children: helperText
			})
		]
	});
});
TextField.propTypes = {
	autoComplete: import_prop_types.default.string,
	autoFocus: import_prop_types.default.bool,
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"primary",
		"secondary",
		"error",
		"info",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	defaultValue: import_prop_types.default.any,
	disabled: import_prop_types.default.bool,
	error: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	helperText: import_prop_types.default.node,
	id: import_prop_types.default.string,
	inputRef: refType,
	label: import_prop_types.default.node,
	margin: import_prop_types.default.oneOf([
		"dense",
		"none",
		"normal"
	]),
	maxRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	minRows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	multiline: import_prop_types.default.bool,
	name: import_prop_types.default.string,
	onBlur: import_prop_types.default.func,
	onChange: import_prop_types.default.func,
	onFocus: import_prop_types.default.func,
	placeholder: import_prop_types.default.string,
	required: import_prop_types.default.bool,
	rows: import_prop_types.default.oneOfType([import_prop_types.default.number, import_prop_types.default.string]),
	select: import_prop_types.default.bool,
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["medium", "small"]), import_prop_types.default.string]),
	slotProps: import_prop_types.default.shape({
		formHelperText: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		htmlInput: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		input: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		inputLabel: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		select: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		formHelperText: import_prop_types.default.elementType,
		htmlInput: import_prop_types.default.elementType,
		input: import_prop_types.default.elementType,
		inputLabel: import_prop_types.default.elementType,
		root: import_prop_types.default.elementType,
		select: import_prop_types.default.elementType
	}),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	type: import_prop_types.default.string,
	value: import_prop_types.default.any,
	variant: import_prop_types.default.oneOf([
		"filled",
		"outlined",
		"standard"
	])
};
//#endregion
export { ModalManager as $, useRovingTabIndexContext as A, FormLabel as B, areEqualValues as C, useRovingTabIndexItem as D, focusWithVisible as E, InputLabel as F, getFormControlUtilityClasses as G, FormHelperText as H, Input as I, getModalUtilityClass as J, FilledInput as K, getInputLabelUtilityClasses as L, getListUtilityClass as M, listClasses as N, useRovingTabIndexRoot as O, ListContext as P, contains_default as Q, inputLabelClasses as R, useSelectFocusSource as S, getOpenInteractionType as T, FormControl as U, FormLabelRoot as V, formControlClasses as W, FocusTrap as X, modalClasses as Y, FOCUSABLE_ATTRIBUTE as Z, getPopoverUtilityClass as _, getSelectUtilityClasses as a, Transition as at, useMenuListContext as b, NativeSelectInput as c, formLabelClasses as ct, menuClasses as d, getFormHelperTextUtilityClasses as dt, Backdrop as et, Popover as f, InputBase as ft, getOffsetTop as g, TextareaAutosize as gt, getOffsetLeft as h, FormControlContext as ht, Select as i, elementAcceptingRef as it, List as j, RovingTabIndexContext as k, Menu as l, getFormLabelUtilityClasses as lt, PopoverRoot as m, useFormControlState as mt, getTextFieldUtilityClass as n, getBackdropUtilityClass as nt, selectClasses as o, getNativeSelectUtilityClasses as ot, PopoverPaper as p, useFormControl as pt, Modal as q, textFieldClasses as r, Fade as rt, OutlinedInput as s, nativeSelectClasses as st, TextField as t, backdropClasses as tt, getMenuUtilityClass as u, formHelperTextClasses as ut, popoverClasses as v, isEmpty as w, SelectFocusSourceProvider as x, MenuList as y, Grow as z };

//# sourceMappingURL=TextField-7P54vgZI.js.map