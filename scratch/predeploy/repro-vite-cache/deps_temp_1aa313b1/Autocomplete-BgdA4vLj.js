import { r as __toESM } from "./chunk-BoAXSpZd.js";
import { t as require_react } from "./react.js";
import { t as require_jsx_runtime } from "./react_jsx-runtime.js";
import { H as useRtl, Mt as clsx, Nt as require_prop_types, V as useId, c as useDefaultProps, ct as generateUtilityClass, d as styled, f as rootShouldForwardProp, gt as keyframes, h as useTheme, ht as css, i as getTransitionStyles, jt as composeClasses, l as memoTheme, nt as useEnhancedEffect, st as generateUtilityClasses } from "./utils-B_lYHpnS.js";
import { t as capitalize_default } from "./capitalize-B03SSZaT.js";
import { C as setRef, F as filledInputClasses, G as ownerDocument, K as useEventCallback, M as outlinedInputClasses, P as inputClasses, R as inputBaseClasses, U as useForkRef_default, X as refType, Z as elementTypeAcceptingRef_default, _ as useEventCallback_default, a as useSlotProps, b as unsupportedProp_default, d as useSlot, i as isLayoutSupported, l as useTimeout, m as useLazyRef, n as Portal, o as HTMLElementType, p as useReducedMotion, q as useForkRef, s as contains$1, t as ArrowDropDown_default, u as useOnMount, x as useId_default, y as useControlled } from "./ArrowDropDown-UgHIvKny.js";
import { t as createSvgIcon } from "./createSvgIcon--mXRPZTK.js";
import { t as chainPropTypes } from "./chainPropTypes-DnQ9m8WU.js";
import { i as integerPropType, t as Paper } from "./Paper-Bjw-HKmq.js";
import { t as createSimplePaletteValueFilter } from "./createSimplePaletteValueFilter-Dr-ahFo_.js";
import { t as CircularProgress } from "./CircularProgress-CABRpH75.js";
//#region frontend/node_modules/@mui/material/Autocomplete/autocompleteClasses.mjs
function getAutocompleteUtilityClass(slot) {
	return generateUtilityClass("MuiAutocomplete", slot);
}
var autocompleteClasses = generateUtilityClasses("MuiAutocomplete", [
	"root",
	"expanded",
	"fullWidth",
	"focused",
	"focusVisible",
	"tag",
	"tagSizeSmall",
	"tagSizeMedium",
	"hasPopupIcon",
	"hasClearIcon",
	"inputRoot",
	"input",
	"inputFocused",
	"endAdornment",
	"clearIndicator",
	"popupIndicator",
	"popupIndicatorOpen",
	"popper",
	"popperDisablePortal",
	"paper",
	"listbox",
	"loading",
	"noOptions",
	"option",
	"groupLabel",
	"groupUl"
]);
//#endregion
//#region frontend/node_modules/@mui/utils/isFocusVisible/isFocusVisible.mjs
/**
* Returns a boolean indicating if the event's target has :focus-visible
*/
function isFocusVisible(element) {
	try {
		return element.matches(":focus-visible");
	} catch (error) {
		if (!window.navigator.userAgent.includes("jsdom")) console.warn(["MUI: The `:focus-visible` pseudo class is not supported in this browser.", "Some components rely on this feature to work properly."].join("\n"));
	}
	return false;
}
//#endregion
//#region frontend/node_modules/@mui/material/utils/useFocusableWhenDisabled.mjs
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
function useFocusableWhenDisabled(parameters) {
	const { focusableWhenDisabled, disabled, composite = false, tabIndex: tabIndexProp = 0, isNativeButton } = parameters;
	const isFocusableComposite = composite && focusableWhenDisabled !== false;
	const isNonFocusableComposite = composite && focusableWhenDisabled === false;
	return import_react.useMemo(() => {
		const additionalProps = { onKeyDown(event) {
			if (disabled && focusableWhenDisabled && event.key !== "Tab") event.preventDefault();
		} };
		if (!composite) {
			additionalProps.tabIndex = tabIndexProp;
			if (!isNativeButton && disabled) additionalProps.tabIndex = focusableWhenDisabled ? tabIndexProp : -1;
		}
		if (isNativeButton && (focusableWhenDisabled || isFocusableComposite) || !isNativeButton && disabled) additionalProps["aria-disabled"] = disabled;
		if (isNativeButton && (!focusableWhenDisabled || isNonFocusableComposite)) additionalProps.disabled = disabled;
		return additionalProps;
	}, [
		composite,
		disabled,
		focusableWhenDisabled,
		isFocusableComposite,
		isNonFocusableComposite,
		isNativeButton,
		tabIndexProp
	]);
}
//#endregion
//#region frontend/node_modules/@mui/material/ButtonBase/useButtonBase.mjs
var EMPTY = {};
function useButtonBase(parameters) {
	const { nativeButton, nativeButtonProp, internalNativeButton = nativeButton, allowInferredHostMismatch = false, disabled, type, hasFormAction = false, tabIndex = 0, focusableWhenDisabled: focusableWhenDisabledParam, stopEventPropagation = false, onBeforeKeyDown, onBeforeKeyUp } = parameters;
	const rootRef = import_react.useRef(null);
	const focusableWhenDisabled = focusableWhenDisabledParam === true;
	const focusableWhenDisabledProps = useFocusableWhenDisabled({
		focusableWhenDisabled,
		disabled,
		isNativeButton: nativeButton,
		tabIndex
	});
	import_react.useEffect(() => {
		const root = rootRef.current;
		if (root == null) return;
		const isButtonTag = root.tagName === "BUTTON";
		if (nativeButtonProp !== void 0) {
			if (nativeButtonProp && !isButtonTag) console.error("MUI: A component that acts as a button expected a native <button> because the `nativeButton` prop is true. Rendering a non-<button> removes native button semantics, which can impact forms and accessibility. Render a real <button> or set `nativeButton` to `false`.");
			if (!nativeButtonProp && isButtonTag) console.error("MUI: A component that acts as a button expected a non-<button> because the `nativeButton` prop is false. Rendering a <button> keeps native behavior while additionally applies non-native attributes and handlers, which can add unintended extra attributes (such as `role` or `aria-disabled`). Render a non-<button> such as <div>, or set `nativeButton` to `true`.");
			return;
		}
		if (allowInferredHostMismatch) return;
		if (internalNativeButton && !isButtonTag) console.error("MUI: A component rendering a native <button> resolved to a non-<button> element, but `nativeButton={false}` was not specified and the resolved root is a non-<button>. When rendering a custom component, set `nativeButton={false}` explicitly or render a <button> element.");
		if (!internalNativeButton && isButtonTag) console.error("MUI: A component that acts as a non-native button resolved to a native <button> element, but `nativeButton={true}` was not specified. When rendering a custom component, set `nativeButton={true}` explicitly or render a non-<button> element.");
	}, [
		allowInferredHostMismatch,
		internalNativeButton,
		nativeButtonProp
	]);
	const hasNativeKeyboardActivation = import_react.useCallback(() => {
		const root = rootRef.current;
		if (root == null) return nativeButton;
		if (root.tagName === "BUTTON") return true;
		return Boolean(root.tagName === "A" && root.href);
	}, [nativeButton]);
	const buttonProps = import_react.useMemo(() => {
		const resolvedButtonProps = focusableWhenDisabled ? {} : { tabIndex: disabled ? -1 : tabIndex };
		if (nativeButton) {
			resolvedButtonProps.type = type === void 0 && !hasFormAction ? "button" : type;
			if (!focusableWhenDisabled) resolvedButtonProps.disabled = disabled;
		} else {
			resolvedButtonProps.role = "button";
			if (!focusableWhenDisabled && disabled) resolvedButtonProps["aria-disabled"] = disabled;
		}
		if (focusableWhenDisabled) return {
			...resolvedButtonProps,
			...focusableWhenDisabledProps
		};
		return resolvedButtonProps;
	}, [
		disabled,
		focusableWhenDisabled,
		focusableWhenDisabledProps,
		hasFormAction,
		nativeButton,
		tabIndex,
		type
	]);
	return {
		getButtonProps: import_react.useCallback((externalProps = EMPTY) => {
			const { onClick: externalOnClick, onKeyDown: externalOnKeyDown, onKeyUp: externalOnKeyUp, ...otherExternalProps } = externalProps;
			const handleClick = (event) => {
				if (stopEventPropagation) event.stopPropagation();
				if (disabled) {
					event.preventDefault();
					return;
				}
				externalOnClick?.(event);
			};
			const handleKeyDown = (event) => {
				if (focusableWhenDisabled) focusableWhenDisabledProps.onKeyDown(event);
				if (disabled) return;
				onBeforeKeyDown?.(event);
				externalOnKeyDown?.(event);
				if (event.target !== event.currentTarget || hasNativeKeyboardActivation()) return;
				if (event.key === " ") {
					event.preventDefault();
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.click();
				}
			};
			const handleKeyUp = (event) => {
				if (disabled) return;
				onBeforeKeyUp?.(event);
				externalOnKeyUp?.(event);
				if (event.target === event.currentTarget && !hasNativeKeyboardActivation() && event.key === " " && !event.defaultPrevented) event.currentTarget.click();
			};
			return {
				...buttonProps,
				...otherExternalProps,
				onClick: handleClick,
				onKeyDown: handleKeyDown,
				onKeyUp: handleKeyUp
			};
		}, [
			buttonProps,
			disabled,
			focusableWhenDisabled,
			focusableWhenDisabledProps,
			hasNativeKeyboardActivation,
			onBeforeKeyDown,
			onBeforeKeyUp,
			stopEventPropagation
		]),
		rootRef
	};
}
//#endregion
//#region frontend/node_modules/@mui/material/useLazyRipple/useLazyRipple.mjs
/**
* Lazy initialization container for the Ripple instance. This improves
* performance by delaying mounting the ripple until it's needed.
*/
var LazyRipple = class LazyRipple {
	/** React ref to the ripple instance */
	/** If the ripple component should be mounted */
	/** Promise that resolves when the ripple component is mounted */
	/** If the ripple component has been mounted */
	/** React state hook setter */
	static create() {
		return new LazyRipple();
	}
	static use() {
		const ripple = useLazyRef(LazyRipple.create).current;
		const [shouldMount, setShouldMount] = import_react.useState(false);
		ripple.shouldMount = shouldMount;
		ripple.setShouldMount = setShouldMount;
		import_react.useEffect(ripple.mountEffect, [shouldMount]);
		return ripple;
	}
	constructor() {
		this.ref = { current: null };
		this.mounted = null;
		this.didMount = false;
		this.shouldMount = false;
		this.setShouldMount = null;
	}
	mount() {
		if (!this.mounted) {
			this.mounted = createControlledPromise();
			this.shouldMount = true;
			this.setShouldMount(this.shouldMount);
		}
		return this.mounted;
	}
	mountEffect = () => {
		if (this.shouldMount && !this.didMount) {
			if (this.ref.current !== null) {
				this.didMount = true;
				this.mounted.resolve();
			}
		}
	};
	start(...args) {
		this.mount().then(() => this.ref.current?.start(...args));
	}
	stop(...args) {
		this.mount().then(() => this.ref.current?.stop(...args));
	}
	pulsate(...args) {
		this.mount().then(() => this.ref.current?.pulsate(...args));
	}
};
function useLazyRipple() {
	return LazyRipple.use();
}
function createControlledPromise() {
	let resolve;
	let reject;
	const p = new Promise((resolveFn, rejectFn) => {
		resolve = resolveFn;
		reject = rejectFn;
	});
	p.resolve = resolve;
	p.reject = reject;
	return p;
}
//#endregion
//#region frontend/node_modules/@mui/material/ButtonBase/Ripple.mjs
var import_prop_types = /* @__PURE__ */ __toESM(require_prop_types(), 1);
var import_jsx_runtime = require_jsx_runtime();
function Ripple(props) {
	const { className, classes, pulsate = false, rippleX, rippleY, rippleSize, in: inProp, onExited, timeout } = props;
	const [leaving, setLeaving] = import_react.useState(false);
	const exitTimer = useTimeout();
	const exitTimerStartedRef = import_react.useRef(false);
	const onExitedRef = import_react.useRef(onExited);
	onExitedRef.current = onExited;
	const hasExitedCallback = onExited != null;
	const rippleClassName = clsx(className, classes.ripple, classes.rippleVisible, pulsate && classes.ripplePulsate);
	const rippleStyles = {
		width: rippleSize,
		height: rippleSize,
		top: -(rippleSize / 2) + rippleY,
		left: -(rippleSize / 2) + rippleX
	};
	const childClassName = clsx(classes.child, leaving && classes.childLeaving, pulsate && classes.childPulsate);
	if (!inProp && !leaving) setLeaving(true);
	import_react.useEffect(() => {
		if (!inProp && hasExitedCallback) {
			if (!exitTimerStartedRef.current) {
				exitTimerStartedRef.current = true;
				exitTimer.start(timeout, () => {
					exitTimerStartedRef.current = false;
					onExitedRef.current?.();
				});
			}
		} else {
			exitTimerStartedRef.current = false;
			exitTimer.clear();
		}
	}, [
		exitTimer,
		hasExitedCallback,
		inProp,
		timeout
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: rippleClassName,
		style: rippleStyles,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: childClassName })
	});
}
Ripple.propTypes = {
	classes: import_prop_types.default.object.isRequired,
	className: import_prop_types.default.string,
	in: import_prop_types.default.bool,
	onExited: import_prop_types.default.func,
	pulsate: import_prop_types.default.bool,
	rippleSize: import_prop_types.default.number,
	rippleX: import_prop_types.default.number,
	rippleY: import_prop_types.default.number,
	timeout: import_prop_types.default.number.isRequired
};
//#endregion
//#region frontend/node_modules/@mui/material/ButtonBase/touchRippleClasses.mjs
function getTouchRippleUtilityClass(slot) {
	return generateUtilityClass("MuiTouchRipple", slot);
}
var touchRippleClasses = generateUtilityClasses("MuiTouchRipple", [
	"root",
	"ripple",
	"rippleVisible",
	"ripplePulsate",
	"child",
	"childLeaving",
	"childPulsate"
]);
//#endregion
//#region frontend/node_modules/@mui/material/ButtonBase/TouchRipple.mjs
var DURATION = 550;
var EMPTY_OBJ = {};
var EMPTY_ARRAY = [];
var NOOP = () => {};
/**
* Keep the same DOM order TouchRipple had when it used react-transition-group:
* exiting ripples stay in place, and new ripples are inserted before the final
* group of ripples that are waiting for their exit animation to finish.
*
* @param {number[]} prevOrder The previous DOM order, including ripples that may be exiting.
* @param {number[]} nextActiveKeys The ripples that should still be treated as active.
* @returns {number[]} The next DOM order, preserving the position of exiting ripples where possible.
*/
function mergeRippleOrder(prevOrder, nextActiveKeys) {
	const nextKeySet = new Set(nextActiveKeys);
	const nextKeysPending = /* @__PURE__ */ new Map();
	let pendingKeys = [];
	for (const prevKey of prevOrder) if (nextKeySet.has(prevKey)) {
		if (pendingKeys.length > 0) {
			nextKeysPending.set(prevKey, pendingKeys);
			pendingKeys = [];
		}
	} else pendingKeys.push(prevKey);
	const nextOrder = [];
	for (const nextKey of nextActiveKeys) {
		const pendingBefore = nextKeysPending.get(nextKey);
		if (pendingBefore) nextOrder.push(...pendingBefore);
		nextOrder.push(nextKey);
	}
	nextOrder.push(...pendingKeys);
	return nextOrder;
}
/**
* Calculate where the ripple should start and how large it must be to cover the host element.
*
* @param {object} params
* @param {object} params.event The mouse or touch event that started the ripple.
* @param {HTMLElement | null} params.element The host element used for measurements. Tests pass `null`.
* @param {boolean} params.center If `true`, start the ripple from the center of the host element.
* @returns {{ rippleX: number, rippleY: number, rippleSize: number }} The ripple position and size.
*/
function computeRippleState({ event, element, center }) {
	const rect = element ? element.getBoundingClientRect() : {
		width: 0,
		height: 0,
		left: 0,
		top: 0
	};
	let rippleX;
	let rippleY;
	if (center || event === void 0 || event.clientX === 0 && event.clientY === 0 || !event.clientX && !event.touches) {
		rippleX = Math.round(rect.width / 2);
		rippleY = Math.round(rect.height / 2);
	} else {
		const { clientX, clientY } = event.touches && event.touches.length > 0 ? event.touches[0] : event;
		rippleX = Math.round(clientX - rect.left);
		rippleY = Math.round(clientY - rect.top);
	}
	let rippleSize;
	if (center) {
		rippleSize = Math.sqrt((2 * rect.width ** 2 + rect.height ** 2) / 3);
		if (rippleSize % 2 === 0) rippleSize += 1;
	} else {
		const sizeX = Math.max(Math.abs((element ? element.clientWidth : 0) - rippleX), rippleX) * 2 + 2;
		const sizeY = Math.max(Math.abs((element ? element.clientHeight : 0) - rippleY), rippleY) * 2 + 2;
		rippleSize = Math.sqrt(sizeX ** 2 + sizeY ** 2);
	}
	return {
		rippleX,
		rippleY,
		rippleSize
	};
}
var enterKeyframe = keyframes`
  0% {
    transform: scale(0);
    opacity: 0.1;
  }

  100% {
    transform: scale(1);
    opacity: 0.3;
  }
`;
var exitKeyframe = keyframes`
  0% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
`;
var pulsateKeyframe = keyframes`
  0% {
    transform: scale(1);
  }

  50% {
    transform: scale(0.92);
  }

  100% {
    transform: scale(1);
  }
`;
function getAnimationStyles(theme) {
	if (theme.motion.reducedMotion === "always") return null;
	const styles = css`
    &.${touchRippleClasses.rippleVisible} {
      animation-name: ${enterKeyframe};
      animation-duration: ${DURATION}ms;
      animation-timing-function: ${theme.transitions.easing.easeInOut};
    }

    &.${touchRippleClasses.ripplePulsate} {
      animation-duration: ${theme.transitions.duration.shorter}ms;
    }

    & .${touchRippleClasses.childLeaving} {
      animation-name: ${exitKeyframe};
      animation-duration: ${DURATION}ms;
      animation-timing-function: ${theme.transitions.easing.easeInOut};
    }

    & .${touchRippleClasses.childPulsate} {
      animation-name: ${pulsateKeyframe};
      animation-duration: 2500ms;
      animation-timing-function: ${theme.transitions.easing.easeInOut};
      animation-iteration-count: infinite;
      animation-delay: 200ms;
    }
  `;
	if (theme.motion.reducedMotion === "system") return css`
      @media (prefers-reduced-motion: no-preference) {
        ${styles}
      }
    `;
	return styles;
}
var TouchRippleRoot = styled("span", {
	name: "MuiTouchRipple",
	slot: "Root"
})({
	overflow: "hidden",
	pointerEvents: "none",
	position: "absolute",
	zIndex: 0,
	top: 0,
	right: 0,
	bottom: 0,
	left: 0,
	borderRadius: "inherit"
});
var TouchRippleRipple = styled(Ripple, {
	name: "MuiTouchRipple",
	slot: "Ripple"
})`
  opacity: 0;
  position: absolute;

  &.${touchRippleClasses.rippleVisible} {
    opacity: 0.3;
    transform: scale(1);
  }

  /*
   * Order matters: 'child', 'childLeaving' and 'childPulsate' apply to the same
   * element with equal specificity, so the later rule wins. 'child' must come
   * before 'childLeaving' so the leaving 'opacity: 0' takes precedence. A focus
   * (pulsate) ripple keeps 'pulsateKeyframe' (no opacity animation) on exit, so
   * it relies on this static 'opacity: 0' to disappear on blur instead of
   * lingering until removal.
   */
  & .${touchRippleClasses.child} {
    opacity: 1;
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background-color: currentColor;
  }

  & .${touchRippleClasses.childLeaving} {
    opacity: 0;
  }

  & .${touchRippleClasses.childPulsate} {
    position: absolute;
    /* @noflip */
    left: 0px;
    top: 0;
  }

  ${({ theme }) => getAnimationStyles(theme)}
`;
/**
* @ignore - internal component.
*/
var TouchRipple = /* @__PURE__ */ import_react.forwardRef(function TouchRipple(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiTouchRipple"
	});
	const reducedMotion = useReducedMotion(useTheme().motion.reducedMotion, false);
	const { center: centerProp = false, classes = EMPTY_OBJ, className, ...other } = props;
	const [rippleState, setRippleState] = import_react.useState({
		items: EMPTY_ARRAY,
		order: EMPTY_ARRAY
	});
	const ripples = rippleState.items;
	const nextKey = import_react.useRef(0);
	const rippleCallback = import_react.useRef(null);
	const mountedRef = import_react.useRef(false);
	useOnMount(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	});
	import_react.useEffect(() => {
		if (rippleCallback.current) {
			rippleCallback.current();
			rippleCallback.current = null;
		}
	}, [ripples]);
	const ignoringMouseDown = import_react.useRef(false);
	const startTimer = useTimeout();
	const startTimerCommit = import_react.useRef(null);
	const container = import_react.useRef(null);
	const handleExited = useEventCallback_default((key) => {
		if (!mountedRef.current) return;
		setRippleState((prevState) => {
			const nextItems = prevState.items.filter((ripple) => ripple.key !== key);
			return {
				items: nextItems,
				order: mergeRippleOrder(prevState.order.filter((rippleKey) => rippleKey !== key), nextItems.filter((ripple) => !ripple.exiting).map((ripple) => ripple.key))
			};
		});
	});
	const startCommit = useEventCallback_default((params) => {
		const { pulsate, rippleX, rippleY, rippleSize, cb } = params;
		const key = nextKey.current;
		nextKey.current += 1;
		setRippleState((prevState) => {
			const nextItems = [...prevState.items, {
				key,
				pulsate,
				rippleX,
				rippleY,
				rippleSize,
				exiting: false
			}];
			return {
				items: nextItems,
				order: mergeRippleOrder(prevState.order, nextItems.filter((ripple) => !ripple.exiting).map((ripple) => ripple.key))
			};
		});
		rippleCallback.current = cb;
	});
	const start = useEventCallback_default((event = EMPTY_OBJ, options = EMPTY_OBJ, cb = NOOP) => {
		const { pulsate = false, center = centerProp || options.pulsate, fakeElement = false } = options;
		if (event?.type === "mousedown" && ignoringMouseDown.current) {
			ignoringMouseDown.current = false;
			return;
		}
		if (event?.type === "touchstart") ignoringMouseDown.current = true;
		const { rippleX, rippleY, rippleSize } = computeRippleState({
			event,
			element: fakeElement ? null : container.current,
			center
		});
		if (event?.touches) {
			if (startTimerCommit.current === null) {
				startTimerCommit.current = () => {
					startCommit({
						pulsate,
						rippleX,
						rippleY,
						rippleSize,
						cb
					});
				};
				startTimer.start(80, () => {
					if (startTimerCommit.current) {
						startTimerCommit.current();
						startTimerCommit.current = null;
					}
				});
			}
		} else startCommit({
			pulsate,
			rippleX,
			rippleY,
			rippleSize,
			cb
		});
	});
	const pulsate = useEventCallback_default(() => {
		start(EMPTY_OBJ, { pulsate: true });
	});
	const stop = useEventCallback_default((event, cb) => {
		startTimer.clear();
		if (event?.type === "touchend" && startTimerCommit.current) {
			startTimerCommit.current();
			startTimerCommit.current = null;
			startTimer.start(0, () => {
				stop(event, cb);
			});
			return;
		}
		startTimerCommit.current = null;
		setRippleState((prevState) => {
			const firstActiveIndex = prevState.items.findIndex((ripple) => !ripple.exiting);
			if (firstActiveIndex === -1) return prevState;
			const nextItems = prevState.items.slice();
			nextItems[firstActiveIndex] = {
				...nextItems[firstActiveIndex],
				exiting: true
			};
			return {
				items: nextItems,
				order: mergeRippleOrder(prevState.order, nextItems.filter((ripple) => !ripple.exiting).map((ripple) => ripple.key))
			};
		});
		rippleCallback.current = cb;
	});
	import_react.useImperativeHandle(ref, () => ({
		pulsate,
		start,
		stop
	}), [
		pulsate,
		start,
		stop
	]);
	const rippleByKey = new Map(ripples.map((ripple) => [ripple.key, ripple]));
	const orderedRipples = rippleState.order.map((rippleKey) => rippleByKey.get(rippleKey)).filter(Boolean);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchRippleRoot, {
		className: clsx(touchRippleClasses.root, classes.root, className),
		ref: container,
		...other,
		children: orderedRipples.map((ripple) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchRippleRipple, {
			classes: {
				ripple: clsx(classes.ripple, touchRippleClasses.ripple),
				rippleVisible: clsx(classes.rippleVisible, touchRippleClasses.rippleVisible),
				ripplePulsate: clsx(classes.ripplePulsate, touchRippleClasses.ripplePulsate),
				child: clsx(classes.child, touchRippleClasses.child),
				childLeaving: clsx(classes.childLeaving, touchRippleClasses.childLeaving),
				childPulsate: clsx(classes.childPulsate, touchRippleClasses.childPulsate)
			},
			timeout: reducedMotion.shouldReduceMotion ? 0 : DURATION,
			pulsate: ripple.pulsate,
			rippleX: ripple.rippleX,
			rippleY: ripple.rippleY,
			rippleSize: ripple.rippleSize,
			in: !ripple.exiting,
			onExited: () => handleExited(ripple.key)
		}, ripple.key))
	});
});
TouchRipple.propTypes = {
	center: import_prop_types.default.bool,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string
};
//#endregion
//#region frontend/node_modules/@mui/material/ButtonBase/buttonBaseClasses.mjs
function getButtonBaseUtilityClass(slot) {
	return generateUtilityClass("MuiButtonBase", slot);
}
var buttonBaseClasses = generateUtilityClasses("MuiButtonBase", [
	"root",
	"disabled",
	"focusVisible"
]);
//#endregion
//#region frontend/node_modules/@mui/material/ButtonBase/ButtonBase.mjs
var useUtilityClasses$5 = (ownerState) => {
	const { disabled, focusVisible, focusVisibleClassName, suppressFocusVisible, classes } = ownerState;
	const composedClasses = composeClasses({ root: [
		"root",
		disabled && "disabled",
		focusVisible && !suppressFocusVisible && "focusVisible"
	] }, getButtonBaseUtilityClass, classes);
	if (focusVisible && !suppressFocusVisible && focusVisibleClassName) composedClasses.root += ` ${focusVisibleClassName}`;
	return composedClasses;
};
var ButtonBaseRoot = styled("button", {
	name: "MuiButtonBase",
	slot: "Root"
})({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	position: "relative",
	boxSizing: "border-box",
	WebkitTapHighlightColor: "transparent",
	backgroundColor: "transparent",
	outline: 0,
	border: 0,
	margin: 0,
	borderRadius: 0,
	padding: 0,
	cursor: "pointer",
	userSelect: "none",
	verticalAlign: "middle",
	MozAppearance: "none",
	WebkitAppearance: "none",
	textDecoration: "none",
	color: "inherit",
	"&::-moz-focus-inner": { borderStyle: "none" },
	[`&.${buttonBaseClasses.disabled}`]: {
		pointerEvents: "none",
		cursor: "default"
	},
	"@media print": { colorAdjust: "exact" }
});
/**
* `ButtonBase` contains as few styles as possible.
* It aims to be a simple building block for creating a button.
* It contains a load of style reset and some focus/ripple logic.
*/
var ButtonBase = /* @__PURE__ */ import_react.forwardRef(function ButtonBase(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiButtonBase"
	});
	const { action, centerRipple = false, children, className, component = "button", disabled = false, disableRipple = false, disableTouchRipple = false, focusRipple = false, focusVisibleClassName, focusableWhenDisabled, suppressFocusVisible = false, internalNativeButton: internalNativeButtonProp, LinkComponent = "a", nativeButton: nativeButtonProp, onBlur, onClick: onClickProp, onContextMenu, onDragLeave, onFocus, onFocusVisible, onKeyDown: onKeyDownProp, onKeyUp: onKeyUpProp, onMouseDown, onMouseLeave, onMouseUp, onTouchEnd, onTouchMove, onTouchStart, tabIndex = 0, TouchRippleProps, touchRippleRef, type, ...other } = props;
	const isLink = Boolean(other.href || other.to);
	const hasFormAction = Boolean(other.formAction);
	let ComponentProp = component;
	if (ComponentProp === "button" && isLink) ComponentProp = LinkComponent;
	const internalNativeButton = typeof ComponentProp === "string" ? ComponentProp === "button" : internalNativeButtonProp ?? false;
	const nativeButton = nativeButtonProp ?? internalNativeButton;
	const ripple = useLazyRipple();
	const handleRippleRef = useForkRef_default(ripple.ref, touchRippleRef);
	const [focusVisible, setFocusVisible] = import_react.useState(false);
	if ((disabled || suppressFocusVisible) && focusVisible) setFocusVisible(false);
	const handleBeforeKeyDown = useEventCallback_default((event) => {
		if (focusRipple && !event.repeat && focusVisible && event.key === " ") ripple.stop(event, () => {
			ripple.start(event);
		});
	});
	const handleBeforeKeyUp = useEventCallback_default((event) => {
		if (focusRipple && event.key === " " && focusVisible && !event.defaultPrevented) ripple.stop(event, () => {
			ripple.pulsate(event);
		});
	});
	const { getButtonProps, rootRef: buttonRef } = useButtonBase({
		nativeButton,
		nativeButtonProp,
		internalNativeButton,
		allowInferredHostMismatch: isLink || typeof ComponentProp === "string",
		disabled,
		type,
		hasFormAction,
		tabIndex,
		onBeforeKeyDown: handleBeforeKeyDown,
		onBeforeKeyUp: handleBeforeKeyUp
	});
	const { onClick, onKeyDown, onKeyUp, ...buttonProps } = getButtonProps({
		onClick: onClickProp,
		onKeyDown: onKeyDownProp,
		onKeyUp: onKeyUpProp
	});
	import_react.useImperativeHandle(action, () => ({ focusVisible: () => {
		setFocusVisible(true);
		buttonRef.current.focus();
	} }), [buttonRef]);
	const enableTouchRipple = ripple.shouldMount && !disableRipple && !disabled;
	import_react.useEffect(() => {
		if (focusVisible && focusRipple && !disableRipple) ripple.pulsate();
	}, [
		disableRipple,
		focusRipple,
		focusVisible,
		ripple
	]);
	const handleMouseDown = useRippleHandler(ripple, "start", onMouseDown, disableTouchRipple);
	const handleContextMenu = useRippleHandler(ripple, "stop", onContextMenu, disableTouchRipple);
	const handleDragLeave = useRippleHandler(ripple, "stop", onDragLeave, disableTouchRipple);
	const handleMouseUp = useRippleHandler(ripple, "stop", onMouseUp, disableTouchRipple);
	const handleMouseLeave = useRippleHandler(ripple, "stop", (event) => {
		if (focusVisible) event.preventDefault();
		if (onMouseLeave) onMouseLeave(event);
	}, disableTouchRipple);
	const handleTouchStart = useRippleHandler(ripple, "start", onTouchStart, disableTouchRipple);
	const handleTouchEnd = useRippleHandler(ripple, "stop", onTouchEnd, disableTouchRipple);
	const handleTouchMove = useRippleHandler(ripple, "stop", onTouchMove, disableTouchRipple);
	const handleBlur = useRippleHandler(ripple, "stop", (event) => {
		if (!isFocusVisible(event.target)) setFocusVisible(false);
		if (onBlur) onBlur(event);
	}, false);
	const handleFocus = useEventCallback_default((event) => {
		if (!buttonRef.current) buttonRef.current = event.currentTarget;
		if (!suppressFocusVisible && isFocusVisible(event.target)) {
			setFocusVisible(true);
			if (onFocusVisible) onFocusVisible(event);
		}
		if (onFocus) onFocus(event);
	});
	const linkProps = {};
	if (isLink) {
		linkProps.tabIndex = disabled ? -1 : tabIndex;
		if (disabled) linkProps["aria-disabled"] = disabled;
		linkProps.type = type;
	}
	const handleRef = useForkRef_default(ref, buttonRef);
	const ownerState = {
		...props,
		centerRipple,
		component,
		disabled,
		disableRipple,
		disableTouchRipple,
		focusRipple,
		suppressFocusVisible,
		tabIndex,
		focusVisible
	};
	const classes = useUtilityClasses$5(ownerState);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ButtonBaseRoot, {
		as: ComponentProp,
		className: clsx(classes.root, className),
		ownerState,
		onBlur: handleBlur,
		onClick,
		onContextMenu: handleContextMenu,
		onFocus: handleFocus,
		onKeyDown,
		onKeyUp,
		onMouseDown: handleMouseDown,
		onMouseLeave: handleMouseLeave,
		onMouseUp: handleMouseUp,
		onDragLeave: handleDragLeave,
		onTouchEnd: handleTouchEnd,
		onTouchMove: handleTouchMove,
		onTouchStart: handleTouchStart,
		ref: handleRef,
		...isLink ? linkProps : buttonProps,
		...other,
		children: [children, enableTouchRipple ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TouchRipple, {
			ref: handleRippleRef,
			center: centerRipple,
			...TouchRippleProps
		}) : null]
	});
});
function useRippleHandler(ripple, rippleAction, eventCallback, skipRippleAction = false) {
	return useEventCallback_default((event) => {
		if (eventCallback) eventCallback(event);
		if (!skipRippleAction) ripple[rippleAction](event);
		return true;
	});
}
ButtonBase.propTypes = {
	action: refType,
	centerRipple: import_prop_types.default.bool,
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	component: elementTypeAcceptingRef_default,
	disabled: import_prop_types.default.bool,
	disableRipple: import_prop_types.default.bool,
	disableTouchRipple: import_prop_types.default.bool,
	focusRipple: import_prop_types.default.bool,
	focusVisibleClassName: import_prop_types.default.string,
	formAction: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.string]),
	href: import_prop_types.default.any,
	LinkComponent: import_prop_types.default.elementType,
	nativeButton: import_prop_types.default.bool,
	onBlur: import_prop_types.default.func,
	onClick: import_prop_types.default.func,
	onContextMenu: import_prop_types.default.func,
	onDragLeave: import_prop_types.default.func,
	onFocus: import_prop_types.default.func,
	onFocusVisible: import_prop_types.default.func,
	onKeyDown: import_prop_types.default.func,
	onKeyUp: import_prop_types.default.func,
	onMouseDown: import_prop_types.default.func,
	onMouseLeave: import_prop_types.default.func,
	onMouseUp: import_prop_types.default.func,
	onTouchEnd: import_prop_types.default.func,
	onTouchMove: import_prop_types.default.func,
	onTouchStart: import_prop_types.default.func,
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	tabIndex: import_prop_types.default.number,
	TouchRippleProps: import_prop_types.default.object,
	touchRippleRef: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.shape({ current: import_prop_types.default.shape({
		pulsate: import_prop_types.default.func.isRequired,
		start: import_prop_types.default.func.isRequired,
		stop: import_prop_types.default.func.isRequired
	}) })]),
	type: import_prop_types.default.string
};
//#endregion
//#region frontend/node_modules/@mui/material/IconButton/iconButtonClasses.mjs
function getIconButtonUtilityClass(slot) {
	return generateUtilityClass("MuiIconButton", slot);
}
var iconButtonClasses = generateUtilityClasses("MuiIconButton", [
	"root",
	"disabled",
	"colorInherit",
	"colorPrimary",
	"colorSecondary",
	"colorError",
	"colorInfo",
	"colorSuccess",
	"colorWarning",
	"edgeStart",
	"edgeEnd",
	"sizeSmall",
	"sizeMedium",
	"sizeLarge",
	"loading",
	"loadingIndicator",
	"loadingWrapper"
]);
//#endregion
//#region frontend/node_modules/@mui/material/IconButton/IconButton.mjs
var useUtilityClasses$4 = (ownerState) => {
	const { classes, disabled, color, edge, size, loading } = ownerState;
	return composeClasses({
		root: [
			"root",
			loading && "loading",
			disabled && "disabled",
			color !== "default" && `color${capitalize_default(color)}`,
			edge && `edge${capitalize_default(edge)}`,
			`size${capitalize_default(size)}`
		],
		loadingIndicator: ["loadingIndicator"],
		loadingWrapper: ["loadingWrapper"]
	}, getIconButtonUtilityClass, classes);
};
var IconButtonRoot = styled(ButtonBase, {
	name: "MuiIconButton",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.root,
			ownerState.loading && styles.loading,
			ownerState.color !== "default" && styles[`color${capitalize_default(ownerState.color)}`],
			ownerState.edge && styles[`edge${capitalize_default(ownerState.edge)}`],
			styles[`size${capitalize_default(ownerState.size)}`]
		];
	}
})(memoTheme(({ theme }) => ({
	textAlign: "center",
	flex: "0 0 auto",
	fontSize: theme.typography.pxToRem(24),
	padding: 8,
	borderRadius: "50%",
	color: (theme.vars || theme).palette.action.active,
	...getTransitionStyles(theme, "background-color", { duration: theme.transitions.duration.shortest }),
	variants: [
		{
			props: (props) => !props.disableRipple,
			style: {
				"--IconButton-hoverBg": theme.alpha((theme.vars || theme).palette.action.active, (theme.vars || theme).palette.action.hoverOpacity),
				"&:hover": {
					backgroundColor: "var(--IconButton-hoverBg)",
					"@media (hover: none)": { backgroundColor: "transparent" }
				}
			}
		},
		{
			props: { edge: "start" },
			style: { marginLeft: -12 }
		},
		{
			props: {
				edge: "start",
				size: "small"
			},
			style: { marginLeft: -3 }
		},
		{
			props: { edge: "end" },
			style: { marginRight: -12 }
		},
		{
			props: {
				edge: "end",
				size: "small"
			},
			style: { marginRight: -3 }
		}
	]
})), memoTheme(({ theme }) => ({
	variants: [
		{
			props: { color: "inherit" },
			style: { color: "inherit" }
		},
		...Object.entries(theme.palette).filter(createSimplePaletteValueFilter()).map(([color]) => ({
			props: { color },
			style: {
				color: (theme.vars || theme).palette[color].main,
				"--IconButton-hoverBg": theme.alpha((theme.vars || theme).palette[color].main, (theme.vars || theme).palette.action.hoverOpacity)
			}
		})),
		{
			props: { size: "small" },
			style: {
				padding: 5,
				fontSize: theme.typography.pxToRem(18)
			}
		},
		{
			props: { size: "large" },
			style: {
				padding: 12,
				fontSize: theme.typography.pxToRem(28)
			}
		}
	],
	[`&.${iconButtonClasses.disabled}`]: {
		backgroundColor: "transparent",
		color: (theme.vars || theme).palette.action.disabled
	},
	[`&.${iconButtonClasses.loading}`]: { color: "transparent" }
})));
var IconButtonLoadingIndicator = styled("span", {
	name: "MuiIconButton",
	slot: "LoadingIndicator"
})(({ theme }) => ({
	display: "none",
	position: "absolute",
	visibility: "visible",
	top: "50%",
	left: "50%",
	transform: "translate(-50%, -50%)",
	color: (theme.vars || theme).palette.action.disabled,
	variants: [{
		props: { loading: true },
		style: { display: "flex" }
	}]
}));
/**
* Refer to the [Icons](/material-ui/icons/) section of the documentation
* regarding the available icon options.
*/
var IconButton = /* @__PURE__ */ import_react.forwardRef(function IconButton(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiIconButton"
	});
	const { edge = false, children, className, color = "default", disabled = false, disableFocusRipple = false, size = "medium", id: idProp, loading = null, loadingIndicator: loadingIndicatorProp, ...other } = props;
	const loadingId = useId_default(idProp);
	const loadingIndicator = loadingIndicatorProp ?? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircularProgress, {
		"aria-labelledby": loadingId,
		color: "inherit",
		size: 16
	});
	const ownerState = {
		...props,
		edge,
		color,
		disabled,
		disableFocusRipple,
		loading,
		loadingIndicator,
		size
	};
	const classes = useUtilityClasses$4(ownerState);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(IconButtonRoot, {
		id: loading ? loadingId : idProp,
		className: clsx(classes.root, className),
		centerRipple: true,
		internalNativeButton: true,
		focusRipple: !disableFocusRipple,
		disabled: disabled || loading,
		ref,
		...other,
		ownerState,
		children: [typeof loading === "boolean" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: classes.loadingWrapper,
			style: { display: "contents" },
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconButtonLoadingIndicator, {
				className: classes.loadingIndicator,
				ownerState,
				children: loading && loadingIndicator
			})
		}), children]
	});
});
IconButton.propTypes = {
	children: chainPropTypes(import_prop_types.default.node, (props) => {
		if (import_react.Children.toArray(props.children).some((child) => /* @__PURE__ */ import_react.isValidElement(child) && child.props.onClick)) return new Error([
			"MUI: You are providing an onClick event listener to a child of a button element.",
			"Prefer applying it to the IconButton directly.",
			"This guarantees that the whole <button> will be responsive to click events."
		].join("\n"));
		return null;
	}),
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"inherit",
		"default",
		"primary",
		"secondary",
		"error",
		"info",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	disabled: import_prop_types.default.bool,
	disableFocusRipple: import_prop_types.default.bool,
	disableRipple: import_prop_types.default.bool,
	edge: import_prop_types.default.oneOf([
		"end",
		"start",
		false
	]),
	id: import_prop_types.default.string,
	loading: import_prop_types.default.bool,
	loadingIndicator: import_prop_types.default.node,
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"small",
		"medium",
		"large"
	]), import_prop_types.default.string]),
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
//#region frontend/node_modules/@mui/material/internal/svg-icons/Close.mjs
/**
* @ignore - internal component.
*
* Alias to `Clear`.
*/
var Close_default = createSvgIcon(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" }), "Close");
//#endregion
//#region frontend/node_modules/@mui/utils/useForcedRerendering/useForcedRerendering.mjs
/**
* Copied from @base-ui/utils
*
* Returns a function that forces a rerender.
*/
function useForcedRerendering() {
	const [, setState] = import_react.useState({});
	return import_react.useCallback(() => {
		setState({});
	}, []);
}
//#endregion
//#region frontend/node_modules/@mui/utils/usePreviousProps/usePreviousProps.mjs
function usePreviousProps(value) {
	const ref = import_react.useRef({});
	import_react.useEffect(() => {
		ref.current = value;
	});
	return ref.current;
}
//#endregion
//#region frontend/node_modules/@mui/material/useAutocomplete/useAutocomplete.mjs
function areArraysSame({ array1, array2, parser = (value) => value }) {
	return array1 && array2 && array1.length === array2.length && array1.every((prevOption, index) => parser(prevOption) === parser(array2[index]));
}
function stripDiacritics(string) {
	return string.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function createFilterOptions(config = {}) {
	const { ignoreAccents = true, ignoreCase = true, limit, matchFrom = "any", stringify, trim = false } = config;
	return (options, { inputValue, getOptionLabel }) => {
		let input = trim ? inputValue.trim() : inputValue;
		if (ignoreCase) input = input.toLowerCase();
		if (ignoreAccents) input = stripDiacritics(input);
		const filteredOptions = !input ? options : options.filter((option) => {
			let candidate = (stringify || getOptionLabel)(option);
			if (ignoreCase) candidate = candidate.toLowerCase();
			if (ignoreAccents) candidate = stripDiacritics(candidate);
			return matchFrom === "start" ? candidate.startsWith(input) : candidate.includes(input);
		});
		return typeof limit === "number" ? filteredOptions.slice(0, limit) : filteredOptions;
	};
}
var defaultFilterOptions = createFilterOptions();
var pageSize = 5;
var defaultIsActiveElementInListbox = (listboxRef) => listboxRef.current !== null && contains$1(listboxRef.current.parentElement, document.activeElement);
var defaultIsOptionEqualToValue = (option, value) => option === value;
var MULTIPLE_DEFAULT_VALUE = [];
function getInputValue(value, multiple, getOptionLabel, renderValue) {
	if (multiple || value == null || renderValue) return "";
	const optionLabel = getOptionLabel(value);
	return typeof optionLabel === "string" ? optionLabel : "";
}
function useAutocomplete(props) {
	const { unstable_isActiveElementInListbox = defaultIsActiveElementInListbox, unstable_classNamePrefix = "Mui", autoComplete = false, autoHighlight = false, autoSelect = false, blurOnSelect = false, clearOnBlur = !props.freeSolo, clearOnEscape = false, componentName = "useAutocomplete", defaultValue = props.multiple ? MULTIPLE_DEFAULT_VALUE : null, disableClearable = false, disableCloseOnSelect = false, disabled: disabledProp, disabledItemsFocusable = false, disableListWrap = false, filterOptions = defaultFilterOptions, filterSelectedOptions = false, freeSolo = false, getOptionDisabled, getOptionKey, getOptionLabel: getOptionLabelProp = (option) => option.label ?? option, groupBy, handleHomeEndKeys = !props.freeSolo, id: idProp, includeInputInList = false, inputValue: inputValueProp, isOptionEqualToValue = defaultIsOptionEqualToValue, multiple = false, onChange, onClose, onHighlightChange, onInputChange, onOpen, open: openProp, openOnFocus = false, options, readOnly = false, renderValue, resetHighlightOnMouseLeave = false, selectOnFocus = !props.freeSolo, value: valueProp } = props;
	const id = useId(idProp);
	let getOptionLabel = getOptionLabelProp;
	getOptionLabel = (option) => {
		const optionLabel = getOptionLabelProp(option);
		if (typeof optionLabel !== "string") {
			{
				const erroneousReturn = optionLabel === void 0 ? "undefined" : `${typeof optionLabel} (${optionLabel})`;
				console.error(`MUI: The \`getOptionLabel\` method of ${componentName} returned ${erroneousReturn} instead of a string for ${JSON.stringify(option)}.`);
			}
			return String(optionLabel);
		}
		return optionLabel;
	};
	const ignoreFocus = import_react.useRef(false);
	const firstFocus = import_react.useRef(true);
	const inputRef = import_react.useRef(null);
	const listboxRef = import_react.useRef(null);
	const ignoreNextBackspaceRef = import_react.useRef(false);
	const windowLostFocus = import_react.useRef(false);
	const [anchorEl, setAnchorEl] = import_react.useState(null);
	const [focusedItem, setFocusedItem] = import_react.useState(-1);
	const defaultHighlighted = autoHighlight ? 0 : -1;
	const highlightedIndexRef = import_react.useRef(defaultHighlighted);
	/** @type {React.RefObject<AutocompleteHighlightChangeReason | null>} */
	const highlightReasonRef = import_react.useRef(null);
	const touchScrolledRef = import_react.useRef(false);
	const isTouchRef = import_react.useRef(false);
	const initialInputValue = import_react.useRef(getInputValue(defaultValue ?? valueProp, multiple, getOptionLabel)).current;
	const [value, setValueState] = useControlled({
		controlled: valueProp,
		default: defaultValue,
		name: componentName
	});
	const [inputValue, setInputValueState] = useControlled({
		controlled: inputValueProp,
		default: initialInputValue,
		name: componentName,
		state: "inputValue"
	});
	const [focused, setFocused] = import_react.useState(false);
	const resetInputValue = import_react.useCallback((event, newValue, reason) => {
		if (!(multiple ? value.length < newValue.length : newValue !== null) && !clearOnBlur && !(reason === "reset" && freeSolo && !multiple && newValue === null)) return;
		const newInputValue = getInputValue(newValue, multiple, getOptionLabel, renderValue);
		if (inputValue === newInputValue) return;
		setInputValueState(newInputValue);
		if (onInputChange) onInputChange(event, newInputValue, reason);
	}, [
		getOptionLabel,
		inputValue,
		multiple,
		onInputChange,
		setInputValueState,
		clearOnBlur,
		freeSolo,
		value,
		renderValue
	]);
	const [open, setOpenState] = useControlled({
		controlled: openProp,
		default: false,
		name: componentName,
		state: "open"
	});
	const [inputPristine, setInputPristine] = import_react.useState(true);
	const inputValueIsSelectedValue = !multiple && value != null && inputValue === getOptionLabel(value);
	const popupOpen = open && !readOnly;
	const selectedValues = import_react.useMemo(() => {
		if (multiple) return value;
		if (value != null) return [value];
		return [];
	}, [multiple, value]);
	const selectedValuesSet = import_react.useMemo(() => {
		if (isOptionEqualToValue !== defaultIsOptionEqualToValue || selectedValues.length === 0) return null;
		return new Set(selectedValues);
	}, [isOptionEqualToValue, selectedValues]);
	const isOptionSelected = import_react.useCallback((option) => {
		if (selectedValuesSet) return selectedValuesSet.has(option);
		return selectedValues.some((value2) => value2 != null && isOptionEqualToValue(option, value2));
	}, [
		isOptionEqualToValue,
		selectedValues,
		selectedValuesSet
	]);
	const filteredOptions = popupOpen ? filterOptions(options.filter((option) => {
		if (filterSelectedOptions && isOptionSelected(option)) return false;
		return true;
	}), {
		inputValue: inputValueIsSelectedValue && inputPristine ? "" : inputValue,
		getOptionLabel
	}) : [];
	const previousProps = usePreviousProps({
		filteredOptions,
		value,
		inputValue
	});
	import_react.useEffect(() => {
		const valueChange = value !== previousProps.value;
		if (focused && !valueChange) return;
		if (freeSolo && (!valueChange || value == null && previousProps.value === void 0)) return;
		resetInputValue(null, value, "reset");
	}, [
		value,
		resetInputValue,
		focused,
		previousProps.value,
		freeSolo
	]);
	const listboxAvailable = open && filteredOptions.length > 0 && !readOnly;
	const focusItem = useEventCallback((itemToFocus) => {
		if (itemToFocus === -1) inputRef.current.focus();
		else anchorEl.querySelector(`[data-item-index="${itemToFocus}"]`).focus();
	});
	import_react.useEffect(() => {
		if (multiple && focusedItem > value.length - 1) {
			setFocusedItem(-1);
			focusItem(-1);
		}
	}, [
		value,
		multiple,
		focusedItem,
		focusItem
	]);
	function validOptionIndex(index, direction) {
		if (!listboxRef.current || index < 0 || index >= filteredOptions.length) return -1;
		let nextFocus = index;
		while (true) {
			const option = listboxRef.current.querySelector(`[data-option-index="${nextFocus}"]`);
			const nextFocusDisabled = disabledItemsFocusable ? false : !option || option.disabled || option.getAttribute("aria-disabled") === "true";
			if (option && option.hasAttribute("tabindex") && !nextFocusDisabled) return nextFocus;
			if (direction === "next") nextFocus = (nextFocus + 1) % filteredOptions.length;
			else nextFocus = (nextFocus - 1 + filteredOptions.length) % filteredOptions.length;
			if (nextFocus === index) return -1;
		}
	}
	const syncHighlightedIndexToDOM = useEventCallback(({ index, reason, preserveScroll = false }) => {
		if (inputRef.current == null && listboxRef.current == null) return;
		if (index === -1) inputRef.current.removeAttribute("aria-activedescendant");
		else inputRef.current.setAttribute("aria-activedescendant", `${id}-option-${index}`);
		if (!listboxRef.current) return;
		const prev = listboxRef.current.querySelector(`[role="option"].${unstable_classNamePrefix}-focused`);
		if (prev) {
			prev.classList.remove(`${unstable_classNamePrefix}-focused`);
			prev.classList.remove(`${unstable_classNamePrefix}-focusVisible`);
		}
		let listboxNode = listboxRef.current;
		if (listboxRef.current.getAttribute("role") !== "listbox") listboxNode = listboxRef.current.parentElement.querySelector("[role=\"listbox\"]");
		if (!listboxNode) return;
		if (index === -1) {
			if (!preserveScroll) listboxNode.scrollTop = 0;
			return;
		}
		const option = listboxRef.current.querySelector(`[data-option-index="${index}"]`);
		if (!option) return;
		option.classList.add(`${unstable_classNamePrefix}-focused`);
		if (reason === "keyboard") option.classList.add(`${unstable_classNamePrefix}-focusVisible`);
		if (listboxNode.scrollHeight > listboxNode.clientHeight && reason !== "mouse" && reason !== "touch") {
			const element = option;
			const scrollBottom = listboxNode.clientHeight + listboxNode.scrollTop;
			const elementBottom = element.offsetTop + element.offsetHeight;
			if (elementBottom > scrollBottom) listboxNode.scrollTop = elementBottom - listboxNode.clientHeight;
			else if (element.offsetTop - element.offsetHeight * (groupBy ? 1.3 : 0) < listboxNode.scrollTop) listboxNode.scrollTop = element.offsetTop - element.offsetHeight * (groupBy ? 1.3 : 0);
		}
	});
	const setHighlightedIndex = useEventCallback(({ event, index, reason, preserveScroll = false }) => {
		highlightedIndexRef.current = index;
		highlightReasonRef.current = reason ?? null;
		if (onHighlightChange && [
			"mouse",
			"keyboard",
			"touch"
		].includes(reason)) onHighlightChange(event, index === -1 ? null : filteredOptions[index], reason);
		syncHighlightedIndexToDOM({
			index,
			reason,
			preserveScroll
		});
	});
	const setHighlightedIndexFromSync = useEventCallback(({ index }) => {
		highlightedIndexRef.current = index;
		syncHighlightedIndexToDOM({
			index,
			reason: highlightReasonRef.current
		});
	});
	const changeHighlightedIndex = useEventCallback(({ event, diff, direction = "next", reason, preserveScroll }) => {
		if (!popupOpen) return;
		if (reason === "keyboard") {
			touchScrolledRef.current = false;
			isTouchRef.current = false;
		}
		const getNextIndex = () => {
			const maxIndex = filteredOptions.length - 1;
			if (diff === "reset") return defaultHighlighted;
			if (diff === "start") return 0;
			if (diff === "end") return maxIndex;
			const newIndex = highlightedIndexRef.current + diff;
			if (newIndex < 0) {
				if (newIndex === -1 && includeInputInList) return -1;
				if (disableListWrap && highlightedIndexRef.current !== -1 || Math.abs(diff) > 1) return 0;
				return maxIndex;
			}
			if (newIndex > maxIndex) {
				if (newIndex === maxIndex + 1 && includeInputInList) return -1;
				if (disableListWrap || Math.abs(diff) > 1) return maxIndex;
				return 0;
			}
			return newIndex;
		};
		const nextIndex = validOptionIndex(getNextIndex(), direction);
		setHighlightedIndex({
			index: nextIndex,
			reason,
			event,
			preserveScroll
		});
		if (autoComplete && diff !== "reset") if (nextIndex === -1) inputRef.current.value = inputValue;
		else {
			const option = getOptionLabel(filteredOptions[nextIndex]);
			inputRef.current.value = option;
			if (option.toLowerCase().indexOf(inputValue.toLowerCase()) === 0 && inputValue.length > 0) inputRef.current.setSelectionRange(inputValue.length, option.length);
		}
	});
	const filteredOptionsChanged = !areArraysSame({
		array1: previousProps.filteredOptions,
		array2: filteredOptions,
		parser: getOptionLabel
	});
	const getPreviousHighlightedOptionIndex = () => {
		const isSameValue = (value1, value2) => {
			return (value1 ? getOptionLabel(value1) : "") === (value2 ? getOptionLabel(value2) : "");
		};
		if (highlightedIndexRef.current !== -1 && !areArraysSame({
			array1: previousProps.filteredOptions,
			array2: filteredOptions,
			parser: getOptionLabel
		}) && previousProps.inputValue === inputValue && (multiple ? value.length === previousProps.value.length && previousProps.value.every((val, i) => getOptionLabel(value[i]) === getOptionLabel(val)) : isSameValue(previousProps.value, value))) {
			const previousHighlightedOption = previousProps.filteredOptions[highlightedIndexRef.current];
			if (previousHighlightedOption) return filteredOptions.findIndex((option) => {
				return getOptionLabel(option) === getOptionLabel(previousHighlightedOption);
			});
		}
		return -1;
	};
	const syncHighlightedIndex = import_react.useCallback(() => {
		if (!popupOpen) return;
		const previousHighlightedOptionIndex = getPreviousHighlightedOptionIndex();
		if (previousHighlightedOptionIndex !== -1) {
			setHighlightedIndexFromSync({ index: previousHighlightedOptionIndex });
			return;
		}
		const valueItem = multiple ? value[0] : value;
		if (filteredOptions.length === 0 || valueItem == null) {
			changeHighlightedIndex({
				diff: "reset",
				preserveScroll: filteredOptionsChanged && previousProps.inputValue === inputValue && previousProps.filteredOptions?.length > 0 && filteredOptions.length > previousProps.filteredOptions.length && previousProps.filteredOptions.every((option, index) => getOptionLabel(option) === getOptionLabel(filteredOptions[index]))
			});
			return;
		}
		if (!listboxRef.current) return;
		if (valueItem != null) {
			const currentOption = filteredOptions[highlightedIndexRef.current];
			if (multiple && currentOption && value.findIndex((val) => isOptionEqualToValue(currentOption, val)) !== -1 && previousProps.filteredOptions?.length > 0) {
				setHighlightedIndexFromSync({ index: highlightedIndexRef.current });
				return;
			}
			const itemIndex = filteredOptions.findIndex((optionItem) => isOptionEqualToValue(optionItem, valueItem));
			if (itemIndex === -1) changeHighlightedIndex({ diff: "reset" });
			else setHighlightedIndex({ index: itemIndex });
			return;
		}
		if (highlightedIndexRef.current >= filteredOptions.length - 1) {
			setHighlightedIndex({ index: filteredOptions.length - 1 });
			return;
		}
		setHighlightedIndex({ index: highlightedIndexRef.current });
	}, [
		filteredOptions.length,
		multiple ? false : value,
		changeHighlightedIndex,
		setHighlightedIndex,
		setHighlightedIndexFromSync,
		popupOpen,
		inputValue,
		multiple
	]);
	const handleListboxRef = useEventCallback((node) => {
		setRef(listboxRef, node);
		if (!node) return;
		syncHighlightedIndex();
	});
	import_react.useEffect(() => {
		if (!inputRef.current || inputRef.current.nodeName !== "INPUT") if (inputRef.current && inputRef.current.nodeName === "TEXTAREA") console.warn([
			`A textarea element was provided to ${componentName} where input was expected.`,
			`This is not a supported scenario but it may work under certain conditions.`,
			`A textarea keyboard navigation may conflict with Autocomplete controls (for example enter and arrow keys).`,
			`Make sure to test keyboard navigation and add custom event handlers if necessary.`
		].join("\n"));
		else console.error([
			`MUI: Unable to find the input element. It was resolved to ${inputRef.current} while an HTMLInputElement was expected.`,
			`Instead, ${componentName} expects an input element.`,
			"",
			componentName === "useAutocomplete" ? "Make sure you have bound getInputProps correctly and that the normal ref/effect resolutions order is guaranteed." : "Make sure you have customized the input component correctly."
		].join("\n"));
	}, [componentName]);
	import_react.useEffect(() => {
		if (filteredOptionsChanged || popupOpen && !disableCloseOnSelect) syncHighlightedIndex();
	}, [
		syncHighlightedIndex,
		filteredOptionsChanged,
		popupOpen,
		disableCloseOnSelect
	]);
	import_react.useEffect(() => {
		if (typeof window === "undefined") return;
		const handleWindowBlur = () => {
			windowLostFocus.current = true;
		};
		window.addEventListener("blur", handleWindowBlur);
		return () => {
			window.removeEventListener("blur", handleWindowBlur);
		};
	}, []);
	const handleOpen = (event) => {
		if (open) return;
		setOpenState(true);
		setInputPristine(true);
		isTouchRef.current = false;
		if (onOpen) onOpen(event);
	};
	const handleClose = (event, reason) => {
		if (!open) return;
		setOpenState(false);
		touchScrolledRef.current = false;
		highlightReasonRef.current = null;
		if (onClose) onClose(event, reason);
	};
	const handleValue = (event, newValue, reason, details) => {
		if (multiple) {
			if (value.length === newValue.length && value.every((val, i) => val === newValue[i])) return;
		} else if (value === newValue) return;
		if (onChange) onChange(event, newValue, reason, details);
		setValueState(newValue);
	};
	const selectNewValue = (event, option, reasonProp = "selectOption", origin = "options") => {
		let reason = reasonProp;
		let newValue = option;
		if (multiple) {
			newValue = Array.isArray(value) ? value.slice() : [];
			{
				const matches = newValue.filter((val) => isOptionEqualToValue(option, val));
				if (matches.length > 1) console.error([`MUI: The \`isOptionEqualToValue\` method of ${componentName} does not handle the arguments correctly.`, `The component expects a single value to match a given option but found ${matches.length} matches.`].join("\n"));
			}
			const itemIndex = newValue.findIndex((valueItem) => isOptionEqualToValue(option, valueItem));
			if (itemIndex === -1) newValue.push(option);
			else if (origin !== "freeSolo") {
				newValue.splice(itemIndex, 1);
				reason = "removeOption";
			}
		}
		resetInputValue(event, newValue, reason);
		handleValue(event, newValue, reason, { option });
		if (!disableCloseOnSelect && (!event || !event.ctrlKey && !event.metaKey)) handleClose(event, reason);
		if (blurOnSelect === true || blurOnSelect === "touch" && isTouchRef.current || blurOnSelect === "mouse" && !isTouchRef.current) inputRef.current.blur();
	};
	function validItemIndex(index, direction) {
		if (index === -1) return -1;
		let nextFocus = index;
		while (true) {
			if (direction === "next" && nextFocus === value.length || direction === "previous" && nextFocus === -1) return -1;
			const option = anchorEl.querySelector(`[data-item-index="${nextFocus}"]`);
			if (!option || !option.hasAttribute("tabindex") || option.disabled || option.getAttribute("aria-disabled") === "true") nextFocus += direction === "next" ? 1 : -1;
			else return nextFocus;
		}
	}
	const handleFocusItem = (event, direction) => {
		if (!multiple) return;
		if (inputValue === "") handleClose(event, "toggleInput");
		let nextItem = focusedItem;
		if (focusedItem === -1 && direction === "previous") {
			nextItem = value.length - 1;
			if (freeSolo && inputValue !== "") {
				setInputValueState("");
				if (onInputChange) onInputChange(event, "", "reset");
			}
		} else {
			nextItem += direction === "next" ? 1 : -1;
			if (nextItem < 0) nextItem = 0;
			if (nextItem === value.length) nextItem = -1;
		}
		nextItem = validItemIndex(nextItem, direction);
		setFocusedItem(nextItem);
		focusItem(nextItem);
	};
	const handleClear = (event) => {
		setInputValueState("");
		if (onInputChange) onInputChange(event, "", "clear");
		handleValue(event, multiple ? [] : null, "clear");
	};
	const handleKeyDown = (other) => (event) => {
		if (other.onKeyDown) other.onKeyDown(event);
		if (event.defaultMuiPrevented) return;
		if (focusedItem !== -1 && !["ArrowLeft", "ArrowRight"].includes(event.key)) {
			setFocusedItem(-1);
			focusItem(-1);
		}
		if (event.which !== 229) switch (event.key) {
			case "Home":
				if (popupOpen && handleHomeEndKeys) {
					event.preventDefault();
					changeHighlightedIndex({
						diff: "start",
						direction: "next",
						reason: "keyboard",
						event
					});
				}
				break;
			case "End":
				if (popupOpen && handleHomeEndKeys) {
					event.preventDefault();
					changeHighlightedIndex({
						diff: "end",
						direction: "previous",
						reason: "keyboard",
						event
					});
				}
				break;
			case "PageUp":
				event.preventDefault();
				changeHighlightedIndex({
					diff: -pageSize,
					direction: "previous",
					reason: "keyboard",
					event
				});
				handleOpen(event);
				break;
			case "PageDown":
				event.preventDefault();
				changeHighlightedIndex({
					diff: pageSize,
					direction: "next",
					reason: "keyboard",
					event
				});
				handleOpen(event);
				break;
			case "ArrowDown":
				event.preventDefault();
				changeHighlightedIndex({
					diff: 1,
					direction: "next",
					reason: "keyboard",
					event
				});
				handleOpen(event);
				break;
			case "ArrowUp":
				event.preventDefault();
				changeHighlightedIndex({
					diff: -1,
					direction: "previous",
					reason: "keyboard",
					event
				});
				handleOpen(event);
				break;
			case "ArrowLeft": {
				const input = inputRef.current;
				if (!(input && input.selectionStart === 0 && input.selectionEnd === 0)) return;
				if (!multiple && renderValue && value != null) {
					if (freeSolo && inputValue !== "") {
						setInputValueState("");
						if (onInputChange) onInputChange(event, "", "reset");
					}
					setFocusedItem(0);
					focusItem(0);
				} else handleFocusItem(event, "previous");
				break;
			}
			case "ArrowRight":
				if (!multiple && renderValue) {
					setFocusedItem(-1);
					focusItem(-1);
				} else handleFocusItem(event, "next");
				break;
			case "Enter": {
				const hasProgrammaticHighlight = popupOpen && highlightedIndexRef.current !== -1 && highlightReasonRef.current === null;
				const shouldCommitFreeSoloOverProgrammaticHighlight = freeSolo && !inputPristine && hasProgrammaticHighlight;
				const shouldSelectHighlighted = !freeSolo || inputPristine || !hasProgrammaticHighlight;
				const shouldPreventSubmitAfterFreeSoloCommit = shouldCommitFreeSoloOverProgrammaticHighlight && !touchScrolledRef.current;
				if (highlightedIndexRef.current !== -1 && popupOpen && shouldSelectHighlighted && !touchScrolledRef.current) {
					const option = filteredOptions[highlightedIndexRef.current];
					const disabled = getOptionDisabled ? getOptionDisabled(option) : false;
					event.preventDefault();
					if (disabled) return;
					selectNewValue(event, option, "selectOption");
					if (autoComplete) inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
				} else if (freeSolo && inputValue !== "" && inputValueIsSelectedValue === false) {
					if (multiple || shouldPreventSubmitAfterFreeSoloCommit) event.preventDefault();
					selectNewValue(event, inputValue, "createOption", "freeSolo");
				} else if (popupOpen && touchScrolledRef.current) {
					event.preventDefault();
					handleClose(event, "escape");
				}
				break;
			}
			case "Escape":
				if (popupOpen) {
					event.preventDefault();
					event.stopPropagation();
					handleClose(event, "escape");
				} else if (clearOnEscape && (inputValue !== "" || multiple && value.length > 0 || renderValue)) {
					event.preventDefault();
					event.stopPropagation();
					handleClear(event);
				}
				break;
			case "Backspace":
				if (ignoreNextBackspaceRef.current) {
					ignoreNextBackspaceRef.current = false;
					break;
				}
				if (multiple && !readOnly && inputValue === "" && value.length > 0) {
					const index = focusedItem === -1 ? value.length - 1 : focusedItem;
					const newValue = value.slice();
					newValue.splice(index, 1);
					handleValue(event, newValue, "removeOption", { option: value[index] });
					if (focusedItem !== -1) {
						ignoreNextBackspaceRef.current = true;
						setTimeout(() => {
							if (ignoreNextBackspaceRef.current) ignoreNextBackspaceRef.current = false;
						}, 0);
					}
				}
				if (!multiple && renderValue && !readOnly && inputValue === "") handleValue(event, null, "removeOption", { option: value });
				break;
			case "Delete":
				if (multiple && !readOnly && inputValue === "" && value.length > 0 && focusedItem !== -1) {
					const index = focusedItem;
					const newValue = value.slice();
					newValue.splice(index, 1);
					handleValue(event, newValue, "removeOption", { option: value[index] });
				}
				if (!multiple && renderValue && !readOnly && inputValue === "") handleValue(event, null, "removeOption", { option: value });
				break;
			default:
		}
	};
	const handleFocus = (event) => {
		setFocused(true);
		if (focusedItem !== -1) {
			setFocusedItem(-1);
			focusItem(-1);
		}
		if (windowLostFocus.current) {
			windowLostFocus.current = false;
			return;
		}
		if (openOnFocus && !ignoreFocus.current) handleOpen(event);
	};
	const handleBlur = (event) => {
		if (unstable_isActiveElementInListbox(listboxRef)) {
			inputRef.current.focus();
			return;
		}
		setFocused(false);
		firstFocus.current = true;
		ignoreFocus.current = false;
		if (autoSelect && highlightedIndexRef.current !== -1 && popupOpen && highlightReasonRef.current !== "mouse" && highlightReasonRef.current !== "touch") selectNewValue(event, filteredOptions[highlightedIndexRef.current], "blur");
		else if (autoSelect && freeSolo && inputValue !== "") selectNewValue(event, inputValue, "blur", "freeSolo");
		else if (clearOnBlur) resetInputValue(event, value, "blur");
		handleClose(event, "blur");
	};
	const handleInputChange = (event) => {
		const newValue = event.target.value;
		const valueChanged = inputValue !== newValue;
		if (valueChanged) {
			setInputValueState(newValue);
			touchScrolledRef.current = false;
			if (onInputChange) onInputChange(event, newValue, "input");
		}
		if (newValue === "") {
			if (!disableClearable && !multiple && !renderValue) handleValue(event, null, "clear");
		} else handleOpen(event);
		if (valueChanged) setInputPristine(false);
	};
	const handleOptionMouseMove = (event) => {
		const index = Number(event.currentTarget.getAttribute("data-option-index"));
		if (highlightedIndexRef.current !== index) setHighlightedIndex({
			event,
			index,
			reason: "mouse"
		});
		else highlightReasonRef.current = "mouse";
		if (!isTouchRef.current) touchScrolledRef.current = false;
	};
	const handleListboxMouseLeave = (event) => {
		if (!resetHighlightOnMouseLeave || highlightedIndexRef.current === -1 || highlightReasonRef.current !== "mouse" || isTouchRef.current) return;
		setHighlightedIndex({
			event,
			index: -1,
			reason: "mouse",
			preserveScroll: true
		});
	};
	const handleOptionTouchStart = (event) => {
		touchScrolledRef.current = false;
		setHighlightedIndex({
			event,
			index: Number(event.currentTarget.getAttribute("data-option-index")),
			reason: "touch"
		});
		isTouchRef.current = true;
	};
	const handleOptionClick = (event) => {
		selectNewValue(event, filteredOptions[Number(event.currentTarget.getAttribute("data-option-index"))], "selectOption");
		isTouchRef.current = false;
	};
	const handleItemDelete = (index) => (event) => {
		const newValue = value.slice();
		newValue.splice(index, 1);
		handleValue(event, newValue, "removeOption", { option: value[index] });
	};
	const handleSingleItemDelete = (event) => {
		handleValue(event, null, "removeOption", { option: value });
	};
	const handlePopupIndicator = (event) => {
		if (open) handleClose(event, "toggleInput");
		else handleOpen(event);
	};
	const handleMouseDown = (event) => {
		if (!contains$1(event.currentTarget, event.target)) return;
		if (anchorEl && !contains$1(anchorEl, event.target)) return;
		if (event.target.getAttribute("id") !== id) event.preventDefault();
	};
	const handleClick = (event) => {
		if (!contains$1(event.currentTarget, event.target)) return;
		if (anchorEl && !contains$1(anchorEl, event.target)) return;
		inputRef.current.focus();
		if (selectOnFocus && firstFocus.current && inputRef.current.selectionEnd - inputRef.current.selectionStart === 0) inputRef.current.select();
		firstFocus.current = false;
	};
	const handleInputMouseDown = (event) => {
		if (!disabledProp && (inputValue === "" || !open) && event.button === 0) handlePopupIndicator(event);
	};
	let dirty = freeSolo && inputValue.length > 0;
	dirty = dirty || (multiple ? value.length > 0 : value !== null);
	let groupedOptions = filteredOptions;
	if (groupBy) {
		const indexBy = /* @__PURE__ */ new Map();
		let warn = false;
		groupedOptions = filteredOptions.reduce((acc, option, index) => {
			const group = groupBy(option);
			if (acc.length > 0 && acc[acc.length - 1].group === group) acc[acc.length - 1].options.push(option);
			else {
				if (indexBy.get(group) && !warn) {
					console.warn(`MUI: The options provided combined with the \`groupBy\` method of ${componentName} returns duplicated headers.`, "You can solve the issue by sorting the options with the output of `groupBy`.");
					warn = true;
				}
				indexBy.set(group, true);
				acc.push({
					key: index,
					index,
					group,
					options: [option]
				});
			}
			return acc;
		}, []);
	}
	if (disabledProp && focused) handleBlur();
	return {
		getRootProps: (other = {}) => ({
			...other,
			onKeyDown: handleKeyDown(other),
			onMouseDown: handleMouseDown,
			onClick: handleClick
		}),
		getInputLabelProps: () => ({
			id: `${id}-label`,
			htmlFor: id
		}),
		getInputProps: () => ({
			id,
			value: inputValue,
			onBlur: handleBlur,
			onFocus: handleFocus,
			onChange: handleInputChange,
			onMouseDown: handleInputMouseDown,
			"aria-activedescendant": popupOpen ? "" : null,
			"aria-autocomplete": autoComplete ? "both" : "list",
			"aria-controls": listboxAvailable ? `${id}-listbox` : void 0,
			"aria-expanded": listboxAvailable,
			autoComplete: "off",
			ref: inputRef,
			autoCapitalize: "none",
			spellCheck: "false",
			role: "combobox",
			disabled: disabledProp
		}),
		getClearProps: () => ({
			tabIndex: -1,
			type: "button",
			onClick: (event) => {
				ignoreFocus.current = true;
				handleClear(event);
			}
		}),
		getItemProps: ({ index = 0 } = {}) => ({
			...multiple && { key: index },
			"data-item-index": index,
			tabIndex: -1,
			onFocus: () => {
				if (focusedItem !== index) setFocusedItem(index);
			},
			...!readOnly && { onDelete: multiple ? handleItemDelete(index) : handleSingleItemDelete }
		}),
		getPopupIndicatorProps: () => ({
			tabIndex: -1,
			type: "button",
			onClick: handlePopupIndicator
		}),
		getListboxProps: (other = {}) => ({
			...other,
			role: "listbox",
			id: `${id}-listbox`,
			"aria-labelledby": `${id}-label`,
			"aria-multiselectable": multiple || void 0,
			ref: handleListboxRef,
			onMouseDown: (event) => {
				other.onMouseDown?.(event);
				if (event.defaultMuiPrevented) return;
				event.preventDefault();
			},
			onScroll: (event) => {
				other.onScroll?.(event);
				if (event.defaultMuiPrevented) return;
				if (isTouchRef.current) touchScrolledRef.current = true;
			},
			onMouseLeave: (event) => {
				other.onMouseLeave?.(event);
				if (event.defaultMuiPrevented) return;
				handleListboxMouseLeave(event);
			}
		}),
		getOptionProps: ({ index, option }) => {
			const selected = isOptionSelected(option);
			const disabled = getOptionDisabled ? getOptionDisabled(option) : false;
			return {
				key: getOptionKey?.(option) ?? getOptionLabel(option),
				tabIndex: -1,
				role: "option",
				id: `${id}-option-${index}`,
				onMouseMove: handleOptionMouseMove,
				onClick: handleOptionClick,
				onTouchStart: handleOptionTouchStart,
				"data-option-index": index,
				"aria-disabled": disabled,
				"aria-selected": selected
			};
		},
		id,
		inputValue,
		value,
		dirty,
		expanded: popupOpen && anchorEl,
		popupOpen,
		focused: focused || focusedItem !== -1,
		anchorEl,
		setAnchorEl,
		focusedItem,
		groupedOptions
	};
}
var bottom = "bottom";
var right = "right";
var left = "left";
var auto = "auto";
var basePlacements = [
	"top",
	bottom,
	right,
	left
];
var start = "start";
var clippingParents = "clippingParents";
var viewport = "viewport";
var popper = "popper";
var reference = "reference";
var variationPlacements = /* @__PURE__ */ basePlacements.reduce(function(acc, placement) {
	return acc.concat([placement + "-" + start, placement + "-end"]);
}, []);
var placements = /* @__PURE__ */ [].concat(basePlacements, [auto]).reduce(function(acc, placement) {
	return acc.concat([
		placement,
		placement + "-" + start,
		placement + "-end"
	]);
}, []);
var modifierPhases = [
	"beforeRead",
	"read",
	"afterRead",
	"beforeMain",
	"main",
	"afterMain",
	"beforeWrite",
	"write",
	"afterWrite"
];
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getNodeName.js
function getNodeName(element) {
	return element ? (element.nodeName || "").toLowerCase() : null;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getWindow.js
function getWindow(node) {
	if (node == null) return window;
	if (node.toString() !== "[object Window]") {
		var ownerDocument = node.ownerDocument;
		return ownerDocument ? ownerDocument.defaultView || window : window;
	}
	return node;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/instanceOf.js
function isElement(node) {
	return node instanceof getWindow(node).Element || node instanceof Element;
}
function isHTMLElement$1(node) {
	return node instanceof getWindow(node).HTMLElement || node instanceof HTMLElement;
}
function isShadowRoot(node) {
	if (typeof ShadowRoot === "undefined") return false;
	return node instanceof getWindow(node).ShadowRoot || node instanceof ShadowRoot;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/applyStyles.js
function applyStyles(_ref) {
	var state = _ref.state;
	Object.keys(state.elements).forEach(function(name) {
		var style = state.styles[name] || {};
		var attributes = state.attributes[name] || {};
		var element = state.elements[name];
		if (!isHTMLElement$1(element) || !getNodeName(element)) return;
		Object.assign(element.style, style);
		Object.keys(attributes).forEach(function(name) {
			var value = attributes[name];
			if (value === false) element.removeAttribute(name);
			else element.setAttribute(name, value === true ? "" : value);
		});
	});
}
function effect$2(_ref2) {
	var state = _ref2.state;
	var initialStyles = {
		popper: {
			position: state.options.strategy,
			left: "0",
			top: "0",
			margin: "0"
		},
		arrow: { position: "absolute" },
		reference: {}
	};
	Object.assign(state.elements.popper.style, initialStyles.popper);
	state.styles = initialStyles;
	if (state.elements.arrow) Object.assign(state.elements.arrow.style, initialStyles.arrow);
	return function() {
		Object.keys(state.elements).forEach(function(name) {
			var element = state.elements[name];
			var attributes = state.attributes[name] || {};
			var style = Object.keys(state.styles.hasOwnProperty(name) ? state.styles[name] : initialStyles[name]).reduce(function(style, property) {
				style[property] = "";
				return style;
			}, {});
			if (!isHTMLElement$1(element) || !getNodeName(element)) return;
			Object.assign(element.style, style);
			Object.keys(attributes).forEach(function(attribute) {
				element.removeAttribute(attribute);
			});
		});
	};
}
var applyStyles_default = {
	name: "applyStyles",
	enabled: true,
	phase: "write",
	fn: applyStyles,
	effect: effect$2,
	requires: ["computeStyles"]
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getBasePlacement.js
function getBasePlacement(placement) {
	return placement.split("-")[0];
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/math.js
var max = Math.max;
var min = Math.min;
var round = Math.round;
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/userAgent.js
function getUAString() {
	var uaData = navigator.userAgentData;
	if (uaData != null && uaData.brands && Array.isArray(uaData.brands)) return uaData.brands.map(function(item) {
		return item.brand + "/" + item.version;
	}).join(" ");
	return navigator.userAgent;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/isLayoutViewport.js
function isLayoutViewport() {
	return !/^((?!chrome|android).)*safari/i.test(getUAString());
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getBoundingClientRect.js
function getBoundingClientRect(element, includeScale, isFixedStrategy) {
	if (includeScale === void 0) includeScale = false;
	if (isFixedStrategy === void 0) isFixedStrategy = false;
	var clientRect = element.getBoundingClientRect();
	var scaleX = 1;
	var scaleY = 1;
	if (includeScale && isHTMLElement$1(element)) {
		scaleX = element.offsetWidth > 0 ? round(clientRect.width) / element.offsetWidth || 1 : 1;
		scaleY = element.offsetHeight > 0 ? round(clientRect.height) / element.offsetHeight || 1 : 1;
	}
	var visualViewport = (isElement(element) ? getWindow(element) : window).visualViewport;
	var addVisualOffsets = !isLayoutViewport() && isFixedStrategy;
	var x = (clientRect.left + (addVisualOffsets && visualViewport ? visualViewport.offsetLeft : 0)) / scaleX;
	var y = (clientRect.top + (addVisualOffsets && visualViewport ? visualViewport.offsetTop : 0)) / scaleY;
	var width = clientRect.width / scaleX;
	var height = clientRect.height / scaleY;
	return {
		width,
		height,
		top: y,
		right: x + width,
		bottom: y + height,
		left: x,
		x,
		y
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getLayoutRect.js
function getLayoutRect(element) {
	var clientRect = getBoundingClientRect(element);
	var width = element.offsetWidth;
	var height = element.offsetHeight;
	if (Math.abs(clientRect.width - width) <= 1) width = clientRect.width;
	if (Math.abs(clientRect.height - height) <= 1) height = clientRect.height;
	return {
		x: element.offsetLeft,
		y: element.offsetTop,
		width,
		height
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/contains.js
function contains(parent, child) {
	var rootNode = child.getRootNode && child.getRootNode();
	if (parent.contains(child)) return true;
	else if (rootNode && isShadowRoot(rootNode)) {
		var next = child;
		do {
			if (next && parent.isSameNode(next)) return true;
			next = next.parentNode || next.host;
		} while (next);
	}
	return false;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getComputedStyle.js
function getComputedStyle(element) {
	return getWindow(element).getComputedStyle(element);
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/isTableElement.js
function isTableElement(element) {
	return [
		"table",
		"td",
		"th"
	].indexOf(getNodeName(element)) >= 0;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getDocumentElement.js
function getDocumentElement(element) {
	return ((isElement(element) ? element.ownerDocument : element.document) || window.document).documentElement;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getParentNode.js
function getParentNode(element) {
	if (getNodeName(element) === "html") return element;
	return element.assignedSlot || element.parentNode || (isShadowRoot(element) ? element.host : null) || getDocumentElement(element);
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getOffsetParent.js
function getTrueOffsetParent(element) {
	if (!isHTMLElement$1(element) || getComputedStyle(element).position === "fixed") return null;
	return element.offsetParent;
}
function getContainingBlock(element) {
	var isFirefox = /firefox/i.test(getUAString());
	if (/Trident/i.test(getUAString()) && isHTMLElement$1(element)) {
		if (getComputedStyle(element).position === "fixed") return null;
	}
	var currentNode = getParentNode(element);
	if (isShadowRoot(currentNode)) currentNode = currentNode.host;
	while (isHTMLElement$1(currentNode) && ["html", "body"].indexOf(getNodeName(currentNode)) < 0) {
		var css = getComputedStyle(currentNode);
		if (css.transform !== "none" || css.perspective !== "none" || css.contain === "paint" || ["transform", "perspective"].indexOf(css.willChange) !== -1 || isFirefox && css.willChange === "filter" || isFirefox && css.filter && css.filter !== "none") return currentNode;
		else currentNode = currentNode.parentNode;
	}
	return null;
}
function getOffsetParent(element) {
	var window = getWindow(element);
	var offsetParent = getTrueOffsetParent(element);
	while (offsetParent && isTableElement(offsetParent) && getComputedStyle(offsetParent).position === "static") offsetParent = getTrueOffsetParent(offsetParent);
	if (offsetParent && (getNodeName(offsetParent) === "html" || getNodeName(offsetParent) === "body" && getComputedStyle(offsetParent).position === "static")) return window;
	return offsetParent || getContainingBlock(element) || window;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getMainAxisFromPlacement.js
function getMainAxisFromPlacement(placement) {
	return ["top", "bottom"].indexOf(placement) >= 0 ? "x" : "y";
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/within.js
function within(min$2, value, max$2) {
	return max(min$2, min(value, max$2));
}
function withinMaxClamp(min, value, max) {
	var v = within(min, value, max);
	return v > max ? max : v;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getFreshSideObject.js
function getFreshSideObject() {
	return {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/mergePaddingObject.js
function mergePaddingObject(paddingObject) {
	return Object.assign({}, getFreshSideObject(), paddingObject);
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/expandToHashMap.js
function expandToHashMap(value, keys) {
	return keys.reduce(function(hashMap, key) {
		hashMap[key] = value;
		return hashMap;
	}, {});
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/arrow.js
var toPaddingObject = function toPaddingObject(padding, state) {
	padding = typeof padding === "function" ? padding(Object.assign({}, state.rects, { placement: state.placement })) : padding;
	return mergePaddingObject(typeof padding !== "number" ? padding : expandToHashMap(padding, basePlacements));
};
function arrow(_ref) {
	var _state$modifiersData$;
	var state = _ref.state, name = _ref.name, options = _ref.options;
	var arrowElement = state.elements.arrow;
	var popperOffsets = state.modifiersData.popperOffsets;
	var basePlacement = getBasePlacement(state.placement);
	var axis = getMainAxisFromPlacement(basePlacement);
	var len = ["left", "right"].indexOf(basePlacement) >= 0 ? "height" : "width";
	if (!arrowElement || !popperOffsets) return;
	var paddingObject = toPaddingObject(options.padding, state);
	var arrowRect = getLayoutRect(arrowElement);
	var minProp = axis === "y" ? "top" : left;
	var maxProp = axis === "y" ? bottom : right;
	var endDiff = state.rects.reference[len] + state.rects.reference[axis] - popperOffsets[axis] - state.rects.popper[len];
	var startDiff = popperOffsets[axis] - state.rects.reference[axis];
	var arrowOffsetParent = getOffsetParent(arrowElement);
	var clientSize = arrowOffsetParent ? axis === "y" ? arrowOffsetParent.clientHeight || 0 : arrowOffsetParent.clientWidth || 0 : 0;
	var centerToReference = endDiff / 2 - startDiff / 2;
	var min = paddingObject[minProp];
	var max = clientSize - arrowRect[len] - paddingObject[maxProp];
	var center = clientSize / 2 - arrowRect[len] / 2 + centerToReference;
	var offset = within(min, center, max);
	var axisProp = axis;
	state.modifiersData[name] = (_state$modifiersData$ = {}, _state$modifiersData$[axisProp] = offset, _state$modifiersData$.centerOffset = offset - center, _state$modifiersData$);
}
function effect$1(_ref2) {
	var state = _ref2.state;
	var _options$element = _ref2.options.element, arrowElement = _options$element === void 0 ? "[data-popper-arrow]" : _options$element;
	if (arrowElement == null) return;
	if (typeof arrowElement === "string") {
		arrowElement = state.elements.popper.querySelector(arrowElement);
		if (!arrowElement) return;
	}
	if (!contains(state.elements.popper, arrowElement)) return;
	state.elements.arrow = arrowElement;
}
var arrow_default = {
	name: "arrow",
	enabled: true,
	phase: "main",
	fn: arrow,
	effect: effect$1,
	requires: ["popperOffsets"],
	requiresIfExists: ["preventOverflow"]
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getVariation.js
function getVariation(placement) {
	return placement.split("-")[1];
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/computeStyles.js
var unsetSides = {
	top: "auto",
	right: "auto",
	bottom: "auto",
	left: "auto"
};
function roundOffsetsByDPR(_ref, win) {
	var x = _ref.x, y = _ref.y;
	var dpr = win.devicePixelRatio || 1;
	return {
		x: round(x * dpr) / dpr || 0,
		y: round(y * dpr) / dpr || 0
	};
}
function mapToStyles(_ref2) {
	var _Object$assign2;
	var popper = _ref2.popper, popperRect = _ref2.popperRect, placement = _ref2.placement, variation = _ref2.variation, offsets = _ref2.offsets, position = _ref2.position, gpuAcceleration = _ref2.gpuAcceleration, adaptive = _ref2.adaptive, roundOffsets = _ref2.roundOffsets, isFixed = _ref2.isFixed;
	var _offsets$x = offsets.x, x = _offsets$x === void 0 ? 0 : _offsets$x, _offsets$y = offsets.y, y = _offsets$y === void 0 ? 0 : _offsets$y;
	var _ref3 = typeof roundOffsets === "function" ? roundOffsets({
		x,
		y
	}) : {
		x,
		y
	};
	x = _ref3.x;
	y = _ref3.y;
	var hasX = offsets.hasOwnProperty("x");
	var hasY = offsets.hasOwnProperty("y");
	var sideX = left;
	var sideY = "top";
	var win = window;
	if (adaptive) {
		var offsetParent = getOffsetParent(popper);
		var heightProp = "clientHeight";
		var widthProp = "clientWidth";
		if (offsetParent === getWindow(popper)) {
			offsetParent = getDocumentElement(popper);
			if (getComputedStyle(offsetParent).position !== "static" && position === "absolute") {
				heightProp = "scrollHeight";
				widthProp = "scrollWidth";
			}
		}
		offsetParent = offsetParent;
		if (placement === "top" || (placement === "left" || placement === "right") && variation === "end") {
			sideY = bottom;
			var offsetY = isFixed && offsetParent === win && win.visualViewport ? win.visualViewport.height : offsetParent[heightProp];
			y -= offsetY - popperRect.height;
			y *= gpuAcceleration ? 1 : -1;
		}
		if (placement === "left" || (placement === "top" || placement === "bottom") && variation === "end") {
			sideX = right;
			var offsetX = isFixed && offsetParent === win && win.visualViewport ? win.visualViewport.width : offsetParent[widthProp];
			x -= offsetX - popperRect.width;
			x *= gpuAcceleration ? 1 : -1;
		}
	}
	var commonStyles = Object.assign({ position }, adaptive && unsetSides);
	var _ref4 = roundOffsets === true ? roundOffsetsByDPR({
		x,
		y
	}, getWindow(popper)) : {
		x,
		y
	};
	x = _ref4.x;
	y = _ref4.y;
	if (gpuAcceleration) {
		var _Object$assign;
		return Object.assign({}, commonStyles, (_Object$assign = {}, _Object$assign[sideY] = hasY ? "0" : "", _Object$assign[sideX] = hasX ? "0" : "", _Object$assign.transform = (win.devicePixelRatio || 1) <= 1 ? "translate(" + x + "px, " + y + "px)" : "translate3d(" + x + "px, " + y + "px, 0)", _Object$assign));
	}
	return Object.assign({}, commonStyles, (_Object$assign2 = {}, _Object$assign2[sideY] = hasY ? y + "px" : "", _Object$assign2[sideX] = hasX ? x + "px" : "", _Object$assign2.transform = "", _Object$assign2));
}
function computeStyles(_ref5) {
	var state = _ref5.state, options = _ref5.options;
	var _options$gpuAccelerat = options.gpuAcceleration, gpuAcceleration = _options$gpuAccelerat === void 0 ? true : _options$gpuAccelerat, _options$adaptive = options.adaptive, adaptive = _options$adaptive === void 0 ? true : _options$adaptive, _options$roundOffsets = options.roundOffsets, roundOffsets = _options$roundOffsets === void 0 ? true : _options$roundOffsets;
	var commonStyles = {
		placement: getBasePlacement(state.placement),
		variation: getVariation(state.placement),
		popper: state.elements.popper,
		popperRect: state.rects.popper,
		gpuAcceleration,
		isFixed: state.options.strategy === "fixed"
	};
	if (state.modifiersData.popperOffsets != null) state.styles.popper = Object.assign({}, state.styles.popper, mapToStyles(Object.assign({}, commonStyles, {
		offsets: state.modifiersData.popperOffsets,
		position: state.options.strategy,
		adaptive,
		roundOffsets
	})));
	if (state.modifiersData.arrow != null) state.styles.arrow = Object.assign({}, state.styles.arrow, mapToStyles(Object.assign({}, commonStyles, {
		offsets: state.modifiersData.arrow,
		position: "absolute",
		adaptive: false,
		roundOffsets
	})));
	state.attributes.popper = Object.assign({}, state.attributes.popper, { "data-popper-placement": state.placement });
}
var computeStyles_default = {
	name: "computeStyles",
	enabled: true,
	phase: "beforeWrite",
	fn: computeStyles,
	data: {}
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/eventListeners.js
var passive = { passive: true };
function effect(_ref) {
	var state = _ref.state, instance = _ref.instance, options = _ref.options;
	var _options$scroll = options.scroll, scroll = _options$scroll === void 0 ? true : _options$scroll, _options$resize = options.resize, resize = _options$resize === void 0 ? true : _options$resize;
	var window = getWindow(state.elements.popper);
	var scrollParents = [].concat(state.scrollParents.reference, state.scrollParents.popper);
	if (scroll) scrollParents.forEach(function(scrollParent) {
		scrollParent.addEventListener("scroll", instance.update, passive);
	});
	if (resize) window.addEventListener("resize", instance.update, passive);
	return function() {
		if (scroll) scrollParents.forEach(function(scrollParent) {
			scrollParent.removeEventListener("scroll", instance.update, passive);
		});
		if (resize) window.removeEventListener("resize", instance.update, passive);
	};
}
var eventListeners_default = {
	name: "eventListeners",
	enabled: true,
	phase: "write",
	fn: function fn() {},
	effect,
	data: {}
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getOppositePlacement.js
var hash$1 = {
	left: "right",
	right: "left",
	bottom: "top",
	top: "bottom"
};
function getOppositePlacement(placement) {
	return placement.replace(/left|right|bottom|top/g, function(matched) {
		return hash$1[matched];
	});
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getOppositeVariationPlacement.js
var hash = {
	start: "end",
	end: "start"
};
function getOppositeVariationPlacement(placement) {
	return placement.replace(/start|end/g, function(matched) {
		return hash[matched];
	});
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getWindowScroll.js
function getWindowScroll(node) {
	var win = getWindow(node);
	return {
		scrollLeft: win.pageXOffset,
		scrollTop: win.pageYOffset
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getWindowScrollBarX.js
function getWindowScrollBarX(element) {
	return getBoundingClientRect(getDocumentElement(element)).left + getWindowScroll(element).scrollLeft;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getViewportRect.js
function getViewportRect(element, strategy) {
	var win = getWindow(element);
	var html = getDocumentElement(element);
	var visualViewport = win.visualViewport;
	var width = html.clientWidth;
	var height = html.clientHeight;
	var x = 0;
	var y = 0;
	if (visualViewport) {
		width = visualViewport.width;
		height = visualViewport.height;
		var layoutViewport = isLayoutViewport();
		if (layoutViewport || !layoutViewport && strategy === "fixed") {
			x = visualViewport.offsetLeft;
			y = visualViewport.offsetTop;
		}
	}
	return {
		width,
		height,
		x: x + getWindowScrollBarX(element),
		y
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getDocumentRect.js
function getDocumentRect(element) {
	var _element$ownerDocumen;
	var html = getDocumentElement(element);
	var winScroll = getWindowScroll(element);
	var body = (_element$ownerDocumen = element.ownerDocument) == null ? void 0 : _element$ownerDocumen.body;
	var width = max(html.scrollWidth, html.clientWidth, body ? body.scrollWidth : 0, body ? body.clientWidth : 0);
	var height = max(html.scrollHeight, html.clientHeight, body ? body.scrollHeight : 0, body ? body.clientHeight : 0);
	var x = -winScroll.scrollLeft + getWindowScrollBarX(element);
	var y = -winScroll.scrollTop;
	if (getComputedStyle(body || html).direction === "rtl") x += max(html.clientWidth, body ? body.clientWidth : 0) - width;
	return {
		width,
		height,
		x,
		y
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/isScrollParent.js
function isScrollParent(element) {
	var _getComputedStyle = getComputedStyle(element), overflow = _getComputedStyle.overflow, overflowX = _getComputedStyle.overflowX, overflowY = _getComputedStyle.overflowY;
	return /auto|scroll|overlay|hidden/.test(overflow + overflowY + overflowX);
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getScrollParent.js
function getScrollParent(node) {
	if ([
		"html",
		"body",
		"#document"
	].indexOf(getNodeName(node)) >= 0) return node.ownerDocument.body;
	if (isHTMLElement$1(node) && isScrollParent(node)) return node;
	return getScrollParent(getParentNode(node));
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/listScrollParents.js
function listScrollParents(element, list) {
	var _element$ownerDocumen;
	if (list === void 0) list = [];
	var scrollParent = getScrollParent(element);
	var isBody = scrollParent === ((_element$ownerDocumen = element.ownerDocument) == null ? void 0 : _element$ownerDocumen.body);
	var win = getWindow(scrollParent);
	var target = isBody ? [win].concat(win.visualViewport || [], isScrollParent(scrollParent) ? scrollParent : []) : scrollParent;
	var updatedList = list.concat(target);
	return isBody ? updatedList : updatedList.concat(listScrollParents(getParentNode(target)));
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/rectToClientRect.js
function rectToClientRect(rect) {
	return Object.assign({}, rect, {
		left: rect.x,
		top: rect.y,
		right: rect.x + rect.width,
		bottom: rect.y + rect.height
	});
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getClippingRect.js
function getInnerBoundingClientRect(element, strategy) {
	var rect = getBoundingClientRect(element, false, strategy === "fixed");
	rect.top = rect.top + element.clientTop;
	rect.left = rect.left + element.clientLeft;
	rect.bottom = rect.top + element.clientHeight;
	rect.right = rect.left + element.clientWidth;
	rect.width = element.clientWidth;
	rect.height = element.clientHeight;
	rect.x = rect.left;
	rect.y = rect.top;
	return rect;
}
function getClientRectFromMixedType(element, clippingParent, strategy) {
	return clippingParent === "viewport" ? rectToClientRect(getViewportRect(element, strategy)) : isElement(clippingParent) ? getInnerBoundingClientRect(clippingParent, strategy) : rectToClientRect(getDocumentRect(getDocumentElement(element)));
}
function getClippingParents(element) {
	var clippingParents = listScrollParents(getParentNode(element));
	var clipperElement = ["absolute", "fixed"].indexOf(getComputedStyle(element).position) >= 0 && isHTMLElement$1(element) ? getOffsetParent(element) : element;
	if (!isElement(clipperElement)) return [];
	return clippingParents.filter(function(clippingParent) {
		return isElement(clippingParent) && contains(clippingParent, clipperElement) && getNodeName(clippingParent) !== "body";
	});
}
function getClippingRect(element, boundary, rootBoundary, strategy) {
	var mainClippingParents = boundary === "clippingParents" ? getClippingParents(element) : [].concat(boundary);
	var clippingParents = [].concat(mainClippingParents, [rootBoundary]);
	var firstClippingParent = clippingParents[0];
	var clippingRect = clippingParents.reduce(function(accRect, clippingParent) {
		var rect = getClientRectFromMixedType(element, clippingParent, strategy);
		accRect.top = max(rect.top, accRect.top);
		accRect.right = min(rect.right, accRect.right);
		accRect.bottom = min(rect.bottom, accRect.bottom);
		accRect.left = max(rect.left, accRect.left);
		return accRect;
	}, getClientRectFromMixedType(element, firstClippingParent, strategy));
	clippingRect.width = clippingRect.right - clippingRect.left;
	clippingRect.height = clippingRect.bottom - clippingRect.top;
	clippingRect.x = clippingRect.left;
	clippingRect.y = clippingRect.top;
	return clippingRect;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/computeOffsets.js
function computeOffsets(_ref) {
	var reference = _ref.reference, element = _ref.element, placement = _ref.placement;
	var basePlacement = placement ? getBasePlacement(placement) : null;
	var variation = placement ? getVariation(placement) : null;
	var commonX = reference.x + reference.width / 2 - element.width / 2;
	var commonY = reference.y + reference.height / 2 - element.height / 2;
	var offsets;
	switch (basePlacement) {
		case "top":
			offsets = {
				x: commonX,
				y: reference.y - element.height
			};
			break;
		case bottom:
			offsets = {
				x: commonX,
				y: reference.y + reference.height
			};
			break;
		case right:
			offsets = {
				x: reference.x + reference.width,
				y: commonY
			};
			break;
		case left:
			offsets = {
				x: reference.x - element.width,
				y: commonY
			};
			break;
		default: offsets = {
			x: reference.x,
			y: reference.y
		};
	}
	var mainAxis = basePlacement ? getMainAxisFromPlacement(basePlacement) : null;
	if (mainAxis != null) {
		var len = mainAxis === "y" ? "height" : "width";
		switch (variation) {
			case start:
				offsets[mainAxis] = offsets[mainAxis] - (reference[len] / 2 - element[len] / 2);
				break;
			case "end":
				offsets[mainAxis] = offsets[mainAxis] + (reference[len] / 2 - element[len] / 2);
				break;
			default:
		}
	}
	return offsets;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/detectOverflow.js
function detectOverflow(state, options) {
	if (options === void 0) options = {};
	var _options = options, _options$placement = _options.placement, placement = _options$placement === void 0 ? state.placement : _options$placement, _options$strategy = _options.strategy, strategy = _options$strategy === void 0 ? state.strategy : _options$strategy, _options$boundary = _options.boundary, boundary = _options$boundary === void 0 ? clippingParents : _options$boundary, _options$rootBoundary = _options.rootBoundary, rootBoundary = _options$rootBoundary === void 0 ? viewport : _options$rootBoundary, _options$elementConte = _options.elementContext, elementContext = _options$elementConte === void 0 ? popper : _options$elementConte, _options$altBoundary = _options.altBoundary, altBoundary = _options$altBoundary === void 0 ? false : _options$altBoundary, _options$padding = _options.padding, padding = _options$padding === void 0 ? 0 : _options$padding;
	var paddingObject = mergePaddingObject(typeof padding !== "number" ? padding : expandToHashMap(padding, basePlacements));
	var altContext = elementContext === "popper" ? reference : popper;
	var popperRect = state.rects.popper;
	var element = state.elements[altBoundary ? altContext : elementContext];
	var clippingClientRect = getClippingRect(isElement(element) ? element : element.contextElement || getDocumentElement(state.elements.popper), boundary, rootBoundary, strategy);
	var referenceClientRect = getBoundingClientRect(state.elements.reference);
	var popperOffsets = computeOffsets({
		reference: referenceClientRect,
		element: popperRect,
		strategy: "absolute",
		placement
	});
	var popperClientRect = rectToClientRect(Object.assign({}, popperRect, popperOffsets));
	var elementClientRect = elementContext === "popper" ? popperClientRect : referenceClientRect;
	var overflowOffsets = {
		top: clippingClientRect.top - elementClientRect.top + paddingObject.top,
		bottom: elementClientRect.bottom - clippingClientRect.bottom + paddingObject.bottom,
		left: clippingClientRect.left - elementClientRect.left + paddingObject.left,
		right: elementClientRect.right - clippingClientRect.right + paddingObject.right
	};
	var offsetData = state.modifiersData.offset;
	if (elementContext === "popper" && offsetData) {
		var offset = offsetData[placement];
		Object.keys(overflowOffsets).forEach(function(key) {
			var multiply = ["right", "bottom"].indexOf(key) >= 0 ? 1 : -1;
			var axis = ["top", "bottom"].indexOf(key) >= 0 ? "y" : "x";
			overflowOffsets[key] += offset[axis] * multiply;
		});
	}
	return overflowOffsets;
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/computeAutoPlacement.js
function computeAutoPlacement(state, options) {
	if (options === void 0) options = {};
	var _options = options, placement = _options.placement, boundary = _options.boundary, rootBoundary = _options.rootBoundary, padding = _options.padding, flipVariations = _options.flipVariations, _options$allowedAutoP = _options.allowedAutoPlacements, allowedAutoPlacements = _options$allowedAutoP === void 0 ? placements : _options$allowedAutoP;
	var variation = getVariation(placement);
	var placements$1 = variation ? flipVariations ? variationPlacements : variationPlacements.filter(function(placement) {
		return getVariation(placement) === variation;
	}) : basePlacements;
	var allowedPlacements = placements$1.filter(function(placement) {
		return allowedAutoPlacements.indexOf(placement) >= 0;
	});
	if (allowedPlacements.length === 0) allowedPlacements = placements$1;
	var overflows = allowedPlacements.reduce(function(acc, placement) {
		acc[placement] = detectOverflow(state, {
			placement,
			boundary,
			rootBoundary,
			padding
		})[getBasePlacement(placement)];
		return acc;
	}, {});
	return Object.keys(overflows).sort(function(a, b) {
		return overflows[a] - overflows[b];
	});
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/flip.js
function getExpandedFallbackPlacements(placement) {
	if (getBasePlacement(placement) === "auto") return [];
	var oppositePlacement = getOppositePlacement(placement);
	return [
		getOppositeVariationPlacement(placement),
		oppositePlacement,
		getOppositeVariationPlacement(oppositePlacement)
	];
}
function flip(_ref) {
	var state = _ref.state, options = _ref.options, name = _ref.name;
	if (state.modifiersData[name]._skip) return;
	var _options$mainAxis = options.mainAxis, checkMainAxis = _options$mainAxis === void 0 ? true : _options$mainAxis, _options$altAxis = options.altAxis, checkAltAxis = _options$altAxis === void 0 ? true : _options$altAxis, specifiedFallbackPlacements = options.fallbackPlacements, padding = options.padding, boundary = options.boundary, rootBoundary = options.rootBoundary, altBoundary = options.altBoundary, _options$flipVariatio = options.flipVariations, flipVariations = _options$flipVariatio === void 0 ? true : _options$flipVariatio, allowedAutoPlacements = options.allowedAutoPlacements;
	var preferredPlacement = state.options.placement;
	var isBasePlacement = getBasePlacement(preferredPlacement) === preferredPlacement;
	var fallbackPlacements = specifiedFallbackPlacements || (isBasePlacement || !flipVariations ? [getOppositePlacement(preferredPlacement)] : getExpandedFallbackPlacements(preferredPlacement));
	var placements = [preferredPlacement].concat(fallbackPlacements).reduce(function(acc, placement) {
		return acc.concat(getBasePlacement(placement) === "auto" ? computeAutoPlacement(state, {
			placement,
			boundary,
			rootBoundary,
			padding,
			flipVariations,
			allowedAutoPlacements
		}) : placement);
	}, []);
	var referenceRect = state.rects.reference;
	var popperRect = state.rects.popper;
	var checksMap = /* @__PURE__ */ new Map();
	var makeFallbackChecks = true;
	var firstFittingPlacement = placements[0];
	for (var i = 0; i < placements.length; i++) {
		var placement = placements[i];
		var _basePlacement = getBasePlacement(placement);
		var isStartVariation = getVariation(placement) === start;
		var isVertical = ["top", bottom].indexOf(_basePlacement) >= 0;
		var len = isVertical ? "width" : "height";
		var overflow = detectOverflow(state, {
			placement,
			boundary,
			rootBoundary,
			altBoundary,
			padding
		});
		var mainVariationSide = isVertical ? isStartVariation ? right : left : isStartVariation ? bottom : "top";
		if (referenceRect[len] > popperRect[len]) mainVariationSide = getOppositePlacement(mainVariationSide);
		var altVariationSide = getOppositePlacement(mainVariationSide);
		var checks = [];
		if (checkMainAxis) checks.push(overflow[_basePlacement] <= 0);
		if (checkAltAxis) checks.push(overflow[mainVariationSide] <= 0, overflow[altVariationSide] <= 0);
		if (checks.every(function(check) {
			return check;
		})) {
			firstFittingPlacement = placement;
			makeFallbackChecks = false;
			break;
		}
		checksMap.set(placement, checks);
	}
	if (makeFallbackChecks) {
		var numberOfChecks = flipVariations ? 3 : 1;
		var _loop = function _loop(_i) {
			var fittingPlacement = placements.find(function(placement) {
				var checks = checksMap.get(placement);
				if (checks) return checks.slice(0, _i).every(function(check) {
					return check;
				});
			});
			if (fittingPlacement) {
				firstFittingPlacement = fittingPlacement;
				return "break";
			}
		};
		for (var _i = numberOfChecks; _i > 0; _i--) if (_loop(_i) === "break") break;
	}
	if (state.placement !== firstFittingPlacement) {
		state.modifiersData[name]._skip = true;
		state.placement = firstFittingPlacement;
		state.reset = true;
	}
}
var flip_default = {
	name: "flip",
	enabled: true,
	phase: "main",
	fn: flip,
	requiresIfExists: ["offset"],
	data: { _skip: false }
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/hide.js
function getSideOffsets(overflow, rect, preventedOffsets) {
	if (preventedOffsets === void 0) preventedOffsets = {
		x: 0,
		y: 0
	};
	return {
		top: overflow.top - rect.height - preventedOffsets.y,
		right: overflow.right - rect.width + preventedOffsets.x,
		bottom: overflow.bottom - rect.height + preventedOffsets.y,
		left: overflow.left - rect.width - preventedOffsets.x
	};
}
function isAnySideFullyClipped(overflow) {
	return [
		"top",
		right,
		bottom,
		left
	].some(function(side) {
		return overflow[side] >= 0;
	});
}
function hide(_ref) {
	var state = _ref.state, name = _ref.name;
	var referenceRect = state.rects.reference;
	var popperRect = state.rects.popper;
	var preventedOffsets = state.modifiersData.preventOverflow;
	var referenceOverflow = detectOverflow(state, { elementContext: "reference" });
	var popperAltOverflow = detectOverflow(state, { altBoundary: true });
	var referenceClippingOffsets = getSideOffsets(referenceOverflow, referenceRect);
	var popperEscapeOffsets = getSideOffsets(popperAltOverflow, popperRect, preventedOffsets);
	var isReferenceHidden = isAnySideFullyClipped(referenceClippingOffsets);
	var hasPopperEscaped = isAnySideFullyClipped(popperEscapeOffsets);
	state.modifiersData[name] = {
		referenceClippingOffsets,
		popperEscapeOffsets,
		isReferenceHidden,
		hasPopperEscaped
	};
	state.attributes.popper = Object.assign({}, state.attributes.popper, {
		"data-popper-reference-hidden": isReferenceHidden,
		"data-popper-escaped": hasPopperEscaped
	});
}
var hide_default = {
	name: "hide",
	enabled: true,
	phase: "main",
	requiresIfExists: ["preventOverflow"],
	fn: hide
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/offset.js
function distanceAndSkiddingToXY(placement, rects, offset) {
	var basePlacement = getBasePlacement(placement);
	var invertDistance = ["left", "top"].indexOf(basePlacement) >= 0 ? -1 : 1;
	var _ref = typeof offset === "function" ? offset(Object.assign({}, rects, { placement })) : offset, skidding = _ref[0], distance = _ref[1];
	skidding = skidding || 0;
	distance = (distance || 0) * invertDistance;
	return ["left", "right"].indexOf(basePlacement) >= 0 ? {
		x: distance,
		y: skidding
	} : {
		x: skidding,
		y: distance
	};
}
function offset(_ref2) {
	var state = _ref2.state, options = _ref2.options, name = _ref2.name;
	var _options$offset = options.offset, offset = _options$offset === void 0 ? [0, 0] : _options$offset;
	var data = placements.reduce(function(acc, placement) {
		acc[placement] = distanceAndSkiddingToXY(placement, state.rects, offset);
		return acc;
	}, {});
	var _data$state$placement = data[state.placement], x = _data$state$placement.x, y = _data$state$placement.y;
	if (state.modifiersData.popperOffsets != null) {
		state.modifiersData.popperOffsets.x += x;
		state.modifiersData.popperOffsets.y += y;
	}
	state.modifiersData[name] = data;
}
var offset_default = {
	name: "offset",
	enabled: true,
	phase: "main",
	requires: ["popperOffsets"],
	fn: offset
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/popperOffsets.js
function popperOffsets(_ref) {
	var state = _ref.state, name = _ref.name;
	state.modifiersData[name] = computeOffsets({
		reference: state.rects.reference,
		element: state.rects.popper,
		strategy: "absolute",
		placement: state.placement
	});
}
var popperOffsets_default = {
	name: "popperOffsets",
	enabled: true,
	phase: "read",
	fn: popperOffsets,
	data: {}
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/getAltAxis.js
function getAltAxis(axis) {
	return axis === "x" ? "y" : "x";
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/modifiers/preventOverflow.js
function preventOverflow(_ref) {
	var state = _ref.state, options = _ref.options, name = _ref.name;
	var _options$mainAxis = options.mainAxis, checkMainAxis = _options$mainAxis === void 0 ? true : _options$mainAxis, _options$altAxis = options.altAxis, checkAltAxis = _options$altAxis === void 0 ? false : _options$altAxis, boundary = options.boundary, rootBoundary = options.rootBoundary, altBoundary = options.altBoundary, padding = options.padding, _options$tether = options.tether, tether = _options$tether === void 0 ? true : _options$tether, _options$tetherOffset = options.tetherOffset, tetherOffset = _options$tetherOffset === void 0 ? 0 : _options$tetherOffset;
	var overflow = detectOverflow(state, {
		boundary,
		rootBoundary,
		padding,
		altBoundary
	});
	var basePlacement = getBasePlacement(state.placement);
	var variation = getVariation(state.placement);
	var isBasePlacement = !variation;
	var mainAxis = getMainAxisFromPlacement(basePlacement);
	var altAxis = getAltAxis(mainAxis);
	var popperOffsets = state.modifiersData.popperOffsets;
	var referenceRect = state.rects.reference;
	var popperRect = state.rects.popper;
	var tetherOffsetValue = typeof tetherOffset === "function" ? tetherOffset(Object.assign({}, state.rects, { placement: state.placement })) : tetherOffset;
	var normalizedTetherOffsetValue = typeof tetherOffsetValue === "number" ? {
		mainAxis: tetherOffsetValue,
		altAxis: tetherOffsetValue
	} : Object.assign({
		mainAxis: 0,
		altAxis: 0
	}, tetherOffsetValue);
	var offsetModifierState = state.modifiersData.offset ? state.modifiersData.offset[state.placement] : null;
	var data = {
		x: 0,
		y: 0
	};
	if (!popperOffsets) return;
	if (checkMainAxis) {
		var _offsetModifierState$;
		var mainSide = mainAxis === "y" ? "top" : left;
		var altSide = mainAxis === "y" ? bottom : right;
		var len = mainAxis === "y" ? "height" : "width";
		var offset = popperOffsets[mainAxis];
		var min$1 = offset + overflow[mainSide];
		var max$1 = offset - overflow[altSide];
		var additive = tether ? -popperRect[len] / 2 : 0;
		var minLen = variation === "start" ? referenceRect[len] : popperRect[len];
		var maxLen = variation === "start" ? -popperRect[len] : -referenceRect[len];
		var arrowElement = state.elements.arrow;
		var arrowRect = tether && arrowElement ? getLayoutRect(arrowElement) : {
			width: 0,
			height: 0
		};
		var arrowPaddingObject = state.modifiersData["arrow#persistent"] ? state.modifiersData["arrow#persistent"].padding : getFreshSideObject();
		var arrowPaddingMin = arrowPaddingObject[mainSide];
		var arrowPaddingMax = arrowPaddingObject[altSide];
		var arrowLen = within(0, referenceRect[len], arrowRect[len]);
		var minOffset = isBasePlacement ? referenceRect[len] / 2 - additive - arrowLen - arrowPaddingMin - normalizedTetherOffsetValue.mainAxis : minLen - arrowLen - arrowPaddingMin - normalizedTetherOffsetValue.mainAxis;
		var maxOffset = isBasePlacement ? -referenceRect[len] / 2 + additive + arrowLen + arrowPaddingMax + normalizedTetherOffsetValue.mainAxis : maxLen + arrowLen + arrowPaddingMax + normalizedTetherOffsetValue.mainAxis;
		var arrowOffsetParent = state.elements.arrow && getOffsetParent(state.elements.arrow);
		var clientOffset = arrowOffsetParent ? mainAxis === "y" ? arrowOffsetParent.clientTop || 0 : arrowOffsetParent.clientLeft || 0 : 0;
		var offsetModifierValue = (_offsetModifierState$ = offsetModifierState == null ? void 0 : offsetModifierState[mainAxis]) != null ? _offsetModifierState$ : 0;
		var tetherMin = offset + minOffset - offsetModifierValue - clientOffset;
		var tetherMax = offset + maxOffset - offsetModifierValue;
		var preventedOffset = within(tether ? min(min$1, tetherMin) : min$1, offset, tether ? max(max$1, tetherMax) : max$1);
		popperOffsets[mainAxis] = preventedOffset;
		data[mainAxis] = preventedOffset - offset;
	}
	if (checkAltAxis) {
		var _offsetModifierState$2;
		var _mainSide = mainAxis === "x" ? "top" : left;
		var _altSide = mainAxis === "x" ? bottom : right;
		var _offset = popperOffsets[altAxis];
		var _len = altAxis === "y" ? "height" : "width";
		var _min = _offset + overflow[_mainSide];
		var _max = _offset - overflow[_altSide];
		var isOriginSide = ["top", left].indexOf(basePlacement) !== -1;
		var _offsetModifierValue = (_offsetModifierState$2 = offsetModifierState == null ? void 0 : offsetModifierState[altAxis]) != null ? _offsetModifierState$2 : 0;
		var _tetherMin = isOriginSide ? _min : _offset - referenceRect[_len] - popperRect[_len] - _offsetModifierValue + normalizedTetherOffsetValue.altAxis;
		var _tetherMax = isOriginSide ? _offset + referenceRect[_len] + popperRect[_len] - _offsetModifierValue - normalizedTetherOffsetValue.altAxis : _max;
		var _preventedOffset = tether && isOriginSide ? withinMaxClamp(_tetherMin, _offset, _tetherMax) : within(tether ? _tetherMin : _min, _offset, tether ? _tetherMax : _max);
		popperOffsets[altAxis] = _preventedOffset;
		data[altAxis] = _preventedOffset - _offset;
	}
	state.modifiersData[name] = data;
}
var preventOverflow_default = {
	name: "preventOverflow",
	enabled: true,
	phase: "main",
	fn: preventOverflow,
	requiresIfExists: ["offset"]
};
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getHTMLElementScroll.js
function getHTMLElementScroll(element) {
	return {
		scrollLeft: element.scrollLeft,
		scrollTop: element.scrollTop
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getNodeScroll.js
function getNodeScroll(node) {
	if (node === getWindow(node) || !isHTMLElement$1(node)) return getWindowScroll(node);
	else return getHTMLElementScroll(node);
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/dom-utils/getCompositeRect.js
function isElementScaled(element) {
	var rect = element.getBoundingClientRect();
	var scaleX = round(rect.width) / element.offsetWidth || 1;
	var scaleY = round(rect.height) / element.offsetHeight || 1;
	return scaleX !== 1 || scaleY !== 1;
}
function getCompositeRect(elementOrVirtualElement, offsetParent, isFixed) {
	if (isFixed === void 0) isFixed = false;
	var isOffsetParentAnElement = isHTMLElement$1(offsetParent);
	var offsetParentIsScaled = isHTMLElement$1(offsetParent) && isElementScaled(offsetParent);
	var documentElement = getDocumentElement(offsetParent);
	var rect = getBoundingClientRect(elementOrVirtualElement, offsetParentIsScaled, isFixed);
	var scroll = {
		scrollLeft: 0,
		scrollTop: 0
	};
	var offsets = {
		x: 0,
		y: 0
	};
	if (isOffsetParentAnElement || !isOffsetParentAnElement && !isFixed) {
		if (getNodeName(offsetParent) !== "body" || isScrollParent(documentElement)) scroll = getNodeScroll(offsetParent);
		if (isHTMLElement$1(offsetParent)) {
			offsets = getBoundingClientRect(offsetParent, true);
			offsets.x += offsetParent.clientLeft;
			offsets.y += offsetParent.clientTop;
		} else if (documentElement) offsets.x = getWindowScrollBarX(documentElement);
	}
	return {
		x: rect.left + scroll.scrollLeft - offsets.x,
		y: rect.top + scroll.scrollTop - offsets.y,
		width: rect.width,
		height: rect.height
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/orderModifiers.js
function order(modifiers) {
	var map = /* @__PURE__ */ new Map();
	var visited = /* @__PURE__ */ new Set();
	var result = [];
	modifiers.forEach(function(modifier) {
		map.set(modifier.name, modifier);
	});
	function sort(modifier) {
		visited.add(modifier.name);
		[].concat(modifier.requires || [], modifier.requiresIfExists || []).forEach(function(dep) {
			if (!visited.has(dep)) {
				var depModifier = map.get(dep);
				if (depModifier) sort(depModifier);
			}
		});
		result.push(modifier);
	}
	modifiers.forEach(function(modifier) {
		if (!visited.has(modifier.name)) sort(modifier);
	});
	return result;
}
function orderModifiers(modifiers) {
	var orderedModifiers = order(modifiers);
	return modifierPhases.reduce(function(acc, phase) {
		return acc.concat(orderedModifiers.filter(function(modifier) {
			return modifier.phase === phase;
		}));
	}, []);
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/debounce.js
function debounce(fn) {
	var pending;
	return function() {
		if (!pending) pending = new Promise(function(resolve) {
			Promise.resolve().then(function() {
				pending = void 0;
				resolve(fn());
			});
		});
		return pending;
	};
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/utils/mergeByName.js
function mergeByName(modifiers) {
	var merged = modifiers.reduce(function(merged, current) {
		var existing = merged[current.name];
		merged[current.name] = existing ? Object.assign({}, existing, current, {
			options: Object.assign({}, existing.options, current.options),
			data: Object.assign({}, existing.data, current.data)
		}) : current;
		return merged;
	}, {});
	return Object.keys(merged).map(function(key) {
		return merged[key];
	});
}
//#endregion
//#region frontend/node_modules/@popperjs/core/lib/createPopper.js
var DEFAULT_OPTIONS = {
	placement: "bottom",
	modifiers: [],
	strategy: "absolute"
};
function areValidElements() {
	for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) args[_key] = arguments[_key];
	return !args.some(function(element) {
		return !(element && typeof element.getBoundingClientRect === "function");
	});
}
function popperGenerator(generatorOptions) {
	if (generatorOptions === void 0) generatorOptions = {};
	var _generatorOptions = generatorOptions, _generatorOptions$def = _generatorOptions.defaultModifiers, defaultModifiers = _generatorOptions$def === void 0 ? [] : _generatorOptions$def, _generatorOptions$def2 = _generatorOptions.defaultOptions, defaultOptions = _generatorOptions$def2 === void 0 ? DEFAULT_OPTIONS : _generatorOptions$def2;
	return function createPopper(reference, popper, options) {
		if (options === void 0) options = defaultOptions;
		var state = {
			placement: "bottom",
			orderedModifiers: [],
			options: Object.assign({}, DEFAULT_OPTIONS, defaultOptions),
			modifiersData: {},
			elements: {
				reference,
				popper
			},
			attributes: {},
			styles: {}
		};
		var effectCleanupFns = [];
		var isDestroyed = false;
		var instance = {
			state,
			setOptions: function setOptions(setOptionsAction) {
				var options = typeof setOptionsAction === "function" ? setOptionsAction(state.options) : setOptionsAction;
				cleanupModifierEffects();
				state.options = Object.assign({}, defaultOptions, state.options, options);
				state.scrollParents = {
					reference: isElement(reference) ? listScrollParents(reference) : reference.contextElement ? listScrollParents(reference.contextElement) : [],
					popper: listScrollParents(popper)
				};
				var orderedModifiers = orderModifiers(mergeByName([].concat(defaultModifiers, state.options.modifiers)));
				state.orderedModifiers = orderedModifiers.filter(function(m) {
					return m.enabled;
				});
				runModifierEffects();
				return instance.update();
			},
			forceUpdate: function forceUpdate() {
				if (isDestroyed) return;
				var _state$elements = state.elements, reference = _state$elements.reference, popper = _state$elements.popper;
				if (!areValidElements(reference, popper)) return;
				state.rects = {
					reference: getCompositeRect(reference, getOffsetParent(popper), state.options.strategy === "fixed"),
					popper: getLayoutRect(popper)
				};
				state.reset = false;
				state.placement = state.options.placement;
				state.orderedModifiers.forEach(function(modifier) {
					return state.modifiersData[modifier.name] = Object.assign({}, modifier.data);
				});
				for (var index = 0; index < state.orderedModifiers.length; index++) {
					if (state.reset === true) {
						state.reset = false;
						index = -1;
						continue;
					}
					var _state$orderedModifie = state.orderedModifiers[index], fn = _state$orderedModifie.fn, _state$orderedModifie2 = _state$orderedModifie.options, _options = _state$orderedModifie2 === void 0 ? {} : _state$orderedModifie2, name = _state$orderedModifie.name;
					if (typeof fn === "function") state = fn({
						state,
						options: _options,
						name,
						instance
					}) || state;
				}
			},
			update: debounce(function() {
				return new Promise(function(resolve) {
					instance.forceUpdate();
					resolve(state);
				});
			}),
			destroy: function destroy() {
				cleanupModifierEffects();
				isDestroyed = true;
			}
		};
		if (!areValidElements(reference, popper)) return instance;
		instance.setOptions(options).then(function(state) {
			if (!isDestroyed && options.onFirstUpdate) options.onFirstUpdate(state);
		});
		function runModifierEffects() {
			state.orderedModifiers.forEach(function(_ref) {
				var name = _ref.name, _ref$options = _ref.options, options = _ref$options === void 0 ? {} : _ref$options, effect = _ref.effect;
				if (typeof effect === "function") {
					var cleanupFn = effect({
						state,
						name,
						instance,
						options
					});
					effectCleanupFns.push(cleanupFn || function noopFn() {});
				}
			});
		}
		function cleanupModifierEffects() {
			effectCleanupFns.forEach(function(fn) {
				return fn();
			});
			effectCleanupFns = [];
		}
		return instance;
	};
}
var createPopper = /* @__PURE__ */ popperGenerator({ defaultModifiers: [
	eventListeners_default,
	popperOffsets_default,
	computeStyles_default,
	applyStyles_default,
	offset_default,
	flip_default,
	preventOverflow_default,
	arrow_default,
	hide_default
] });
//#endregion
//#region frontend/node_modules/@mui/material/Popper/popperClasses.mjs
function getPopperUtilityClass(slot) {
	return generateUtilityClass("MuiPopper", slot);
}
var popperClasses = generateUtilityClasses("MuiPopper", ["root"]);
//#endregion
//#region frontend/node_modules/@mui/material/Popper/BasePopper.mjs
function flipPlacement(placement, direction) {
	if (direction === "ltr") return placement;
	switch (placement) {
		case "bottom-end": return "bottom-start";
		case "bottom-start": return "bottom-end";
		case "top-end": return "top-start";
		case "top-start": return "top-end";
		default: return placement;
	}
}
function resolveAnchorEl(anchorEl) {
	return typeof anchorEl === "function" ? anchorEl() : anchorEl;
}
function isHTMLElement(element) {
	return element.nodeType !== void 0;
}
function isVirtualElement(element) {
	return !isHTMLElement(element);
}
var useUtilityClasses$3 = (ownerState) => {
	const { classes } = ownerState;
	return composeClasses({ root: ["root"] }, getPopperUtilityClass, classes);
};
var defaultPopperOptions = {};
var PopperTooltip = /* @__PURE__ */ import_react.forwardRef(function PopperTooltip(props, forwardedRef) {
	const { anchorEl, children, direction, disablePortal, modifiers, open, placement: initialPlacement, popperOptions, popperRef: popperRefProp, slotProps = {}, slots = {}, TransitionProps, ownerState: ownerStateProp, ...other } = props;
	const tooltipRef = import_react.useRef(null);
	const ownRef = useForkRef(tooltipRef, forwardedRef);
	const popperRef = import_react.useRef(null);
	const handlePopperRef = useForkRef(popperRef, popperRefProp);
	const handlePopperRefRef = import_react.useRef(handlePopperRef);
	useEnhancedEffect(() => {
		handlePopperRefRef.current = handlePopperRef;
	}, [handlePopperRef]);
	import_react.useImperativeHandle(popperRefProp, () => popperRef.current, []);
	const rtlPlacement = flipPlacement(initialPlacement, direction);
	/**
	* placement initialized from prop but can change during lifetime if modifiers.flip.
	* modifiers.flip is essentially a flip for controlled/uncontrolled behavior
	*/
	const [placement, setPlacement] = import_react.useState(rtlPlacement);
	const resolvedAnchorElement = import_react.useMemo(() => resolveAnchorEl(anchorEl), [anchorEl]);
	import_react.useEffect(() => {
		if (popperRef.current) popperRef.current.forceUpdate();
	});
	useEnhancedEffect(() => {
		if (!resolvedAnchorElement || !open) return;
		const handlePopperUpdate = (data) => {
			setPlacement(data.placement);
		};
		if (resolvedAnchorElement && isHTMLElement(resolvedAnchorElement) && resolvedAnchorElement.nodeType === 1) {
			const box = resolvedAnchorElement.getBoundingClientRect();
			if (isLayoutSupported() && box.top === 0 && box.left === 0 && box.right === 0 && box.bottom === 0) console.warn([
				"MUI: The `anchorEl` prop provided to the component is invalid.",
				"The anchor element should be part of the document layout.",
				"Make sure the element is present in the document or that it's not display none."
			].join("\n"));
		}
		let popperModifiers = [
			{
				name: "preventOverflow",
				options: { altBoundary: disablePortal }
			},
			{
				name: "flip",
				options: { altBoundary: disablePortal }
			},
			{
				name: "onUpdate",
				enabled: true,
				phase: "afterWrite",
				fn: ({ state }) => {
					handlePopperUpdate(state);
				}
			}
		];
		if (modifiers != null) popperModifiers = popperModifiers.concat(modifiers);
		if (popperOptions && popperOptions.modifiers != null) popperModifiers = popperModifiers.concat(popperOptions.modifiers);
		const popper = createPopper(resolvedAnchorElement, tooltipRef.current, {
			placement: rtlPlacement,
			...popperOptions,
			modifiers: popperModifiers
		});
		handlePopperRefRef.current(popper);
		const popperElement = tooltipRef.current;
		return () => {
			if (popperElement) {
				const { style } = popperElement;
				const position = style.position;
				const top = style.top;
				const left = style.left;
				const transform = style.transform;
				popper.destroy();
				style.position = position;
				style.top = top;
				style.left = left;
				style.transform = transform;
			} else popper.destroy();
			handlePopperRefRef.current(null);
		};
	}, [
		resolvedAnchorElement,
		disablePortal,
		modifiers,
		open,
		popperOptions,
		rtlPlacement
	]);
	const childProps = { placement };
	if (TransitionProps !== null) childProps.TransitionProps = TransitionProps;
	const classes = useUtilityClasses$3(props);
	const Root = slots.root ?? "div";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root, {
		...useSlotProps({
			elementType: Root,
			externalSlotProps: slotProps.root,
			externalForwardedProps: other,
			additionalProps: {
				role: "tooltip",
				ref: ownRef
			},
			ownerState: props,
			className: classes.root
		}),
		children: typeof children === "function" ? children(childProps) : children
	});
});
/**
* @ignore - internal component.
*/
var Popper$1 = /* @__PURE__ */ import_react.forwardRef(function Popper(props, forwardedRef) {
	const { anchorEl, children, container: containerProp, direction = "ltr", disablePortal = false, keepMounted = false, modifiers, open, placement = "bottom", popperOptions = defaultPopperOptions, popperRef, style, transition = false, slotProps = {}, slots = {}, ...other } = props;
	const [exited, setExited] = import_react.useState(true);
	const handleEnter = () => {
		setExited(false);
	};
	const handleExited = () => {
		setExited(true);
	};
	if (!keepMounted && !open && (!transition || exited)) return null;
	let container;
	if (containerProp) container = containerProp;
	else if (anchorEl) {
		const resolvedAnchorEl = resolveAnchorEl(anchorEl);
		container = resolvedAnchorEl && isHTMLElement(resolvedAnchorEl) ? ownerDocument(resolvedAnchorEl).body : ownerDocument(null).body;
	}
	const display = !open && keepMounted && (!transition || exited) ? "none" : void 0;
	const transitionProps = transition ? {
		in: open,
		onEnter: handleEnter,
		onExited: handleExited
	} : void 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Portal, {
		disablePortal,
		container,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopperTooltip, {
			anchorEl,
			direction,
			disablePortal,
			modifiers,
			ref: forwardedRef,
			open: transition ? !exited : open,
			placement,
			popperOptions,
			popperRef,
			slotProps,
			slots,
			...other,
			style: {
				position: "fixed",
				top: 0,
				left: 0,
				display,
				...style
			},
			TransitionProps: transitionProps,
			children
		})
	});
});
Popper$1.propTypes = {
	anchorEl: chainPropTypes(import_prop_types.default.oneOfType([
		HTMLElementType,
		import_prop_types.default.object,
		import_prop_types.default.func
	]), (props) => {
		if (props.open) {
			const resolvedAnchorEl = resolveAnchorEl(props.anchorEl);
			if (resolvedAnchorEl && isHTMLElement(resolvedAnchorEl) && resolvedAnchorEl.nodeType === 1) {
				const box = resolvedAnchorEl.getBoundingClientRect();
				if (isLayoutSupported() && box.top === 0 && box.left === 0 && box.right === 0 && box.bottom === 0) return new Error([
					"MUI: The `anchorEl` prop provided to the component is invalid.",
					"The anchor element should be part of the document layout.",
					"Make sure the element is present in the document or that it's not display none."
				].join("\n"));
			} else if (!resolvedAnchorEl || typeof resolvedAnchorEl.getBoundingClientRect !== "function" || isVirtualElement(resolvedAnchorEl) && resolvedAnchorEl.contextElement != null && resolvedAnchorEl.contextElement.nodeType !== 1) return new Error([
				"MUI: The `anchorEl` prop provided to the component is invalid.",
				"It should be an HTML element instance or a virtualElement ",
				"(https://popper.js.org/docs/v2/virtual-elements/)."
			].join("\n"));
		}
		return null;
	}),
	children: import_prop_types.default.oneOfType([import_prop_types.default.node, import_prop_types.default.func]),
	container: import_prop_types.default.oneOfType([HTMLElementType, import_prop_types.default.func]),
	direction: import_prop_types.default.oneOf(["ltr", "rtl"]),
	disablePortal: import_prop_types.default.bool,
	keepMounted: import_prop_types.default.bool,
	modifiers: import_prop_types.default.arrayOf(import_prop_types.default.shape({
		data: import_prop_types.default.object,
		effect: import_prop_types.default.func,
		enabled: import_prop_types.default.bool,
		fn: import_prop_types.default.func,
		name: import_prop_types.default.any,
		options: import_prop_types.default.object,
		phase: import_prop_types.default.oneOf([
			"afterMain",
			"afterRead",
			"afterWrite",
			"beforeMain",
			"beforeRead",
			"beforeWrite",
			"main",
			"read",
			"write"
		]),
		requires: import_prop_types.default.arrayOf(import_prop_types.default.string),
		requiresIfExists: import_prop_types.default.arrayOf(import_prop_types.default.string)
	})),
	open: import_prop_types.default.bool.isRequired,
	placement: import_prop_types.default.oneOf([
		"auto-end",
		"auto-start",
		"auto",
		"bottom-end",
		"bottom-start",
		"bottom",
		"left-end",
		"left-start",
		"left",
		"right-end",
		"right-start",
		"right",
		"top-end",
		"top-start",
		"top"
	]),
	popperOptions: import_prop_types.default.shape({
		modifiers: import_prop_types.default.array,
		onFirstUpdate: import_prop_types.default.func,
		placement: import_prop_types.default.oneOf([
			"auto-end",
			"auto-start",
			"auto",
			"bottom-end",
			"bottom-start",
			"bottom",
			"left-end",
			"left-start",
			"left",
			"right-end",
			"right-start",
			"right",
			"top-end",
			"top-start",
			"top"
		]),
		strategy: import_prop_types.default.oneOf(["absolute", "fixed"])
	}),
	popperRef: refType,
	slotProps: import_prop_types.default.shape({ root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]) }),
	slots: import_prop_types.default.shape({ root: import_prop_types.default.elementType }),
	transition: import_prop_types.default.bool
};
//#endregion
//#region frontend/node_modules/@mui/material/Popper/Popper.mjs
var PopperRoot = styled(Popper$1, {
	name: "MuiPopper",
	slot: "Root"
})({});
/**
*
* Demos:
*
* - [Autocomplete](https://mui.com/material-ui/react-autocomplete/)
* - [Menu](https://mui.com/material-ui/react-menu/)
* - [Popper](https://mui.com/material-ui/react-popper/)
*
* API:
*
* - [Popper API](https://mui.com/material-ui/api/popper/)
*/
var Popper = /* @__PURE__ */ import_react.forwardRef(function Popper(inProps, ref) {
	const isRtl = useRtl();
	const { anchorEl, component, container, disablePortal, keepMounted, modifiers, open, placement, popperOptions, popperRef, transition, slots, slotProps, ...other } = useDefaultProps({
		props: inProps,
		name: "MuiPopper"
	});
	const otherProps = {
		anchorEl,
		container,
		disablePortal,
		keepMounted,
		modifiers,
		open,
		placement,
		popperOptions,
		popperRef,
		transition,
		...other
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopperRoot, {
		as: component,
		direction: isRtl ? "rtl" : "ltr",
		slots,
		slotProps,
		...otherProps,
		ref
	});
});
Popper.propTypes = {
	anchorEl: import_prop_types.default.oneOfType([
		HTMLElementType,
		import_prop_types.default.object,
		import_prop_types.default.func
	]),
	children: import_prop_types.default.oneOfType([import_prop_types.default.node, import_prop_types.default.func]),
	component: import_prop_types.default.elementType,
	container: import_prop_types.default.oneOfType([HTMLElementType, import_prop_types.default.func]),
	disablePortal: import_prop_types.default.bool,
	keepMounted: import_prop_types.default.bool,
	modifiers: import_prop_types.default.arrayOf(import_prop_types.default.shape({
		data: import_prop_types.default.object,
		effect: import_prop_types.default.func,
		enabled: import_prop_types.default.bool,
		fn: import_prop_types.default.func,
		name: import_prop_types.default.any,
		options: import_prop_types.default.object,
		phase: import_prop_types.default.oneOf([
			"afterMain",
			"afterRead",
			"afterWrite",
			"beforeMain",
			"beforeRead",
			"beforeWrite",
			"main",
			"read",
			"write"
		]),
		requires: import_prop_types.default.arrayOf(import_prop_types.default.string),
		requiresIfExists: import_prop_types.default.arrayOf(import_prop_types.default.string)
	})),
	open: import_prop_types.default.bool.isRequired,
	placement: import_prop_types.default.oneOf([
		"auto-end",
		"auto-start",
		"auto",
		"bottom-end",
		"bottom-start",
		"bottom",
		"left-end",
		"left-start",
		"left",
		"right-end",
		"right-start",
		"right",
		"top-end",
		"top-start",
		"top"
	]),
	popperOptions: import_prop_types.default.shape({
		modifiers: import_prop_types.default.array,
		onFirstUpdate: import_prop_types.default.func,
		placement: import_prop_types.default.oneOf([
			"auto-end",
			"auto-start",
			"auto",
			"bottom-end",
			"bottom-start",
			"bottom",
			"left-end",
			"left-start",
			"left",
			"right-end",
			"right-start",
			"right",
			"top-end",
			"top-start",
			"top"
		]),
		strategy: import_prop_types.default.oneOf(["absolute", "fixed"])
	}),
	popperRef: refType,
	slotProps: import_prop_types.default.shape({ root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]) }),
	slots: import_prop_types.default.shape({ root: import_prop_types.default.elementType }),
	sx: import_prop_types.default.oneOfType([
		import_prop_types.default.arrayOf(import_prop_types.default.oneOfType([
			import_prop_types.default.func,
			import_prop_types.default.object,
			import_prop_types.default.bool
		])),
		import_prop_types.default.func,
		import_prop_types.default.object
	]),
	transition: import_prop_types.default.bool
};
//#endregion
//#region frontend/node_modules/@mui/material/ListSubheader/listSubheaderClasses.mjs
function getListSubheaderUtilityClass(slot) {
	return generateUtilityClass("MuiListSubheader", slot);
}
var listSubheaderClasses = generateUtilityClasses("MuiListSubheader", [
	"root",
	"colorPrimary",
	"colorInherit",
	"gutters",
	"inset",
	"sticky"
]);
//#endregion
//#region frontend/node_modules/@mui/material/ListSubheader/ListSubheader.mjs
var useUtilityClasses$2 = (ownerState) => {
	const { classes, color, disableGutters, inset, disableSticky } = ownerState;
	return composeClasses({ root: [
		"root",
		color !== "default" && `color${capitalize_default(color)}`,
		!disableGutters && "gutters",
		inset && "inset",
		!disableSticky && "sticky"
	] }, getListSubheaderUtilityClass, classes);
};
var ListSubheaderRoot = styled("li", {
	name: "MuiListSubheader",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			styles.root,
			ownerState.color !== "default" && styles[`color${capitalize_default(ownerState.color)}`],
			!ownerState.disableGutters && styles.gutters,
			ownerState.inset && styles.inset,
			!ownerState.disableSticky && styles.sticky
		];
	}
})(memoTheme(({ theme }) => ({
	boxSizing: "border-box",
	lineHeight: "48px",
	listStyle: "none",
	color: (theme.vars || theme).palette.text.secondary,
	fontFamily: theme.typography.fontFamily,
	fontWeight: theme.typography.fontWeightMedium,
	fontSize: theme.typography.pxToRem(14),
	variants: [
		{
			props: { color: "primary" },
			style: { color: (theme.vars || theme).palette.primary.main }
		},
		{
			props: { color: "inherit" },
			style: { color: "inherit" }
		},
		{
			props: ({ ownerState }) => !ownerState.disableGutters,
			style: {
				paddingLeft: 16,
				paddingRight: 16
			}
		},
		{
			props: ({ ownerState }) => ownerState.inset,
			style: { paddingLeft: 72 }
		},
		{
			props: ({ ownerState }) => !ownerState.disableSticky,
			style: {
				position: "sticky",
				top: 0,
				zIndex: 1,
				backgroundColor: (theme.vars || theme).palette.background.paper
			}
		}
	]
})));
var ListSubheader = /* @__PURE__ */ import_react.forwardRef(function ListSubheader(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiListSubheader"
	});
	const { className, color = "default", component = "li", disableGutters = false, disableSticky = false, inset = false, ...other } = props;
	const ownerState = {
		...props,
		color,
		component,
		disableGutters,
		disableSticky,
		inset
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSubheaderRoot, {
		as: component,
		className: clsx(useUtilityClasses$2(ownerState).root, className),
		ref,
		ownerState,
		...other
	});
});
ListSubheader.propTypes = {
	children: import_prop_types.default.node,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	color: import_prop_types.default.oneOf([
		"default",
		"inherit",
		"primary"
	]),
	component: import_prop_types.default.elementType,
	disableGutters: import_prop_types.default.bool,
	disableSticky: import_prop_types.default.bool,
	inset: import_prop_types.default.bool,
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
//#region frontend/node_modules/@mui/material/internal/svg-icons/Cancel.mjs
/**
* @ignore - internal component.
*/
var Cancel_default = createSvgIcon(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" }), "Cancel");
//#endregion
//#region frontend/node_modules/@mui/material/Chip/chipClasses.mjs
function getChipUtilityClass(slot) {
	return generateUtilityClass("MuiChip", slot);
}
var chipClasses = generateUtilityClasses("MuiChip", [
	"root",
	"sizeSmall",
	"sizeMedium",
	"colorDefault",
	"colorError",
	"colorInfo",
	"colorPrimary",
	"colorSecondary",
	"colorSuccess",
	"colorWarning",
	"disabled",
	"clickable",
	"deletable",
	"outlined",
	"filled",
	"avatar",
	"icon",
	"label",
	"deleteIcon",
	"focusVisible"
]);
//#endregion
//#region frontend/node_modules/@mui/material/Chip/Chip.mjs
var useUtilityClasses$1 = (ownerState) => {
	const { classes, disabled, size, color, onDelete, clickable, variant } = ownerState;
	return composeClasses({
		root: [
			"root",
			variant,
			disabled && "disabled",
			`size${capitalize_default(size)}`,
			`color${capitalize_default(color)}`,
			clickable && "clickable",
			onDelete && "deletable"
		],
		label: ["label"],
		avatar: ["avatar"],
		icon: ["icon"],
		deleteIcon: ["deleteIcon"]
	}, getChipUtilityClass, classes);
};
var ChipRoot = styled("div", {
	name: "MuiChip",
	slot: "Root",
	shouldForwardProp: (prop) => rootShouldForwardProp(prop) && prop !== "focusableWhenDisabled" && prop !== "skipFocusWhenDisabled",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		const { color, clickable, onDelete, size, variant } = ownerState;
		return [
			{ [`& .${chipClasses.avatar}`]: styles.avatar },
			{ [`& .${chipClasses.icon}`]: styles.icon },
			{ [`& .${chipClasses.deleteIcon}`]: styles.deleteIcon },
			styles.root,
			styles[`size${capitalize_default(size)}`],
			styles[`color${capitalize_default(color)}`],
			clickable && styles.clickable,
			onDelete && styles.deletable,
			styles[variant]
		];
	}
})(memoTheme(({ theme }) => {
	const textColor = theme.palette.mode === "light" ? theme.palette.grey[700] : theme.palette.grey[300];
	return {
		maxWidth: "100%",
		fontFamily: theme.typography.fontFamily,
		fontSize: theme.typography.pxToRem(13),
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		height: 32,
		lineHeight: 1.5,
		color: (theme.vars || theme).palette.text.primary,
		backgroundColor: (theme.vars || theme).palette.action.selected,
		borderRadius: 32 / 2,
		whiteSpace: "nowrap",
		...getTransitionStyles(theme, ["background-color", "box-shadow"]),
		cursor: "unset",
		outline: 0,
		textDecoration: "none",
		border: 0,
		padding: 0,
		verticalAlign: "middle",
		boxSizing: "border-box",
		[`&.${chipClasses.disabled}`]: {
			opacity: (theme.vars || theme).palette.action.disabledOpacity,
			pointerEvents: "none"
		},
		[`& .${chipClasses.avatar}`]: {
			marginLeft: 5,
			marginRight: -6,
			width: 24,
			height: 24,
			color: theme.vars ? theme.vars.palette.Chip.defaultAvatarColor : textColor,
			fontSize: theme.typography.pxToRem(12)
		},
		[`& .${chipClasses.icon}`]: {
			marginLeft: 5,
			marginRight: -6
		},
		[`& .${chipClasses.deleteIcon}`]: {
			WebkitTapHighlightColor: "transparent",
			color: theme.alpha((theme.vars || theme).palette.text.primary, .26),
			fontSize: 22,
			cursor: "pointer",
			margin: "0 5px 0 -6px",
			"&:hover": { color: theme.alpha((theme.vars || theme).palette.text.primary, .4) }
		},
		variants: [
			{
				props: { color: "primary" },
				style: { [`& .${chipClasses.avatar}`]: {
					color: (theme.vars || theme).palette.primary.contrastText,
					backgroundColor: (theme.vars || theme).palette.primary.dark
				} }
			},
			{
				props: { color: "secondary" },
				style: { [`& .${chipClasses.avatar}`]: {
					color: (theme.vars || theme).palette.secondary.contrastText,
					backgroundColor: (theme.vars || theme).palette.secondary.dark
				} }
			},
			{
				props: { size: "small" },
				style: {
					height: 24,
					[`& .${chipClasses.avatar}`]: {
						marginLeft: 4,
						marginRight: -4,
						width: 18,
						height: 18,
						fontSize: theme.typography.pxToRem(10)
					},
					[`& .${chipClasses.icon}`]: {
						fontSize: 18,
						marginLeft: 4,
						marginRight: -4
					},
					[`& .${chipClasses.deleteIcon}`]: {
						fontSize: 16,
						marginRight: 4,
						marginLeft: -4
					}
				}
			},
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter(["contrastText"])).map(([color]) => {
				return {
					props: { color },
					style: {
						backgroundColor: (theme.vars || theme).palette[color].main,
						color: (theme.vars || theme).palette[color].contrastText,
						[`& .${chipClasses.deleteIcon}`]: {
							color: theme.alpha((theme.vars || theme).palette[color].contrastText, .7),
							"&:hover, &:active": { color: (theme.vars || theme).palette[color].contrastText }
						}
					}
				};
			}),
			{
				props: (props) => props.iconColor === props.color,
				style: { [`& .${chipClasses.icon}`]: { color: theme.vars ? theme.vars.palette.Chip.defaultIconColor : textColor } }
			},
			{
				props: (props) => props.iconColor === props.color && props.color !== "default",
				style: { [`& .${chipClasses.icon}`]: { color: "inherit" } }
			},
			{
				props: { onDelete: true },
				style: { [`&.${chipClasses.focusVisible}`]: { backgroundColor: theme.alpha((theme.vars || theme).palette.action.selected, `${(theme.vars || theme).palette.action.selectedOpacity} + ${(theme.vars || theme).palette.action.focusOpacity}`) } }
			},
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter(["dark"])).map(([color]) => {
				return {
					props: {
						color,
						onDelete: true
					},
					style: { [`&.${chipClasses.focusVisible}`]: { background: (theme.vars || theme).palette[color].dark } }
				};
			}),
			{
				props: { clickable: true },
				style: {
					userSelect: "none",
					WebkitTapHighlightColor: "transparent",
					cursor: "pointer",
					"&:hover": { backgroundColor: theme.alpha((theme.vars || theme).palette.action.selected, `${(theme.vars || theme).palette.action.selectedOpacity} + ${(theme.vars || theme).palette.action.hoverOpacity}`) },
					[`&.${chipClasses.focusVisible}`]: { backgroundColor: theme.alpha((theme.vars || theme).palette.action.selected, `${(theme.vars || theme).palette.action.selectedOpacity} + ${(theme.vars || theme).palette.action.focusOpacity}`) },
					"&:active": { boxShadow: (theme.vars || theme).shadows[1] }
				}
			},
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter(["dark"])).map(([color]) => ({
				props: {
					color,
					clickable: true
				},
				style: { [`&:hover, &.${chipClasses.focusVisible}`]: { backgroundColor: (theme.vars || theme).palette[color].dark } }
			})),
			{
				props: { variant: "outlined" },
				style: {
					backgroundColor: "transparent",
					border: theme.vars ? `1px solid ${theme.vars.palette.Chip.defaultBorder}` : `1px solid ${theme.palette.mode === "light" ? theme.palette.grey[400] : theme.palette.grey[700]}`,
					[`&.${chipClasses.clickable}:hover`]: { backgroundColor: (theme.vars || theme).palette.action.hover },
					[`&.${chipClasses.focusVisible}`]: { backgroundColor: (theme.vars || theme).palette.action.focus },
					[`& .${chipClasses.avatar}`]: { marginLeft: 4 },
					[`& .${chipClasses.icon}`]: { marginLeft: 4 },
					[`& .${chipClasses.deleteIcon}`]: { marginRight: 5 }
				}
			},
			{
				props: {
					size: "small",
					variant: "outlined"
				},
				style: {
					[`& .${chipClasses.avatar}`]: { marginLeft: 2 },
					[`& .${chipClasses.icon}`]: { marginLeft: 2 },
					[`& .${chipClasses.deleteIcon}`]: { marginRight: 3 }
				}
			},
			...Object.entries(theme.palette).filter(createSimplePaletteValueFilter()).map(([color]) => ({
				props: {
					variant: "outlined",
					color
				},
				style: {
					color: (theme.vars || theme).palette[color].main,
					border: `1px solid ${theme.alpha((theme.vars || theme).palette[color].main, .7)}`,
					[`&.${chipClasses.clickable}:hover`]: { backgroundColor: theme.alpha((theme.vars || theme).palette[color].main, (theme.vars || theme).palette.action.hoverOpacity) },
					[`&.${chipClasses.focusVisible}`]: { backgroundColor: theme.alpha((theme.vars || theme).palette[color].main, (theme.vars || theme).palette.action.focusOpacity) },
					[`& .${chipClasses.deleteIcon}`]: {
						color: theme.alpha((theme.vars || theme).palette[color].main, .7),
						"&:hover, &:active": { color: (theme.vars || theme).palette[color].main }
					}
				}
			}))
		]
	};
}));
var ChipLabel = styled("span", {
	name: "MuiChip",
	slot: "Label"
})({
	overflow: "hidden",
	textOverflow: "ellipsis",
	paddingLeft: 12,
	paddingRight: 12,
	whiteSpace: "nowrap",
	variants: [
		{
			props: { variant: "outlined" },
			style: {
				paddingLeft: 11,
				paddingRight: 11
			}
		},
		{
			props: { size: "small" },
			style: {
				paddingLeft: 8,
				paddingRight: 8
			}
		},
		{
			props: {
				size: "small",
				variant: "outlined"
			},
			style: {
				paddingLeft: 7,
				paddingRight: 7
			}
		}
	]
});
function isDeleteKeyboardEvent(keyboardEvent) {
	return keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete";
}
/**
* Chips represent complex entities in small blocks, such as a contact.
*/
var Chip = /* @__PURE__ */ import_react.forwardRef(function Chip(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiChip"
	});
	const { avatar: avatarProp, className, clickable: clickableProp, color = "default", component: ComponentProp, deleteIcon: deleteIconProp, disabled = false, icon: iconProp, label, onClick, onDelete, onKeyDown, onKeyUp, size = "medium", variant = "filled", tabIndex, skipFocusWhenDisabled = false, slots = {}, slotProps = {}, ...other } = props;
	const { nativeButton, ...buttonBaseProps } = other;
	const handleRef = useForkRef_default(import_react.useRef(null), ref);
	const handleDeleteIconClick = (event) => {
		event.stopPropagation();
		onDelete(event);
	};
	const handleKeyDown = (event) => {
		if (event.currentTarget === event.target && isDeleteKeyboardEvent(event)) event.preventDefault();
		if (onKeyDown) onKeyDown(event);
	};
	const handleKeyUp = (event) => {
		if (event.currentTarget === event.target) {
			if (onDelete && isDeleteKeyboardEvent(event)) onDelete(event);
		}
		if (onKeyUp) onKeyUp(event);
	};
	const clickable = clickableProp !== false && onClick ? true : clickableProp;
	const component = clickable || onDelete ? ButtonBase : ComponentProp || "div";
	const ownerState = {
		...props,
		component,
		disabled,
		size,
		color,
		iconColor: /* @__PURE__ */ import_react.isValidElement(iconProp) ? iconProp.props.color || color : color,
		onDelete: !!onDelete,
		clickable,
		variant
	};
	const classes = useUtilityClasses$1(ownerState);
	const moreProps = component === ButtonBase ? {
		component: ComponentProp || "div",
		internalNativeButton: false,
		focusVisibleClassName: classes.focusVisible,
		...onDelete && { disableRipple: true },
		...nativeButton !== void 0 && { nativeButton }
	} : {};
	let deleteIcon = null;
	if (onDelete) deleteIcon = deleteIconProp && /* @__PURE__ */ import_react.isValidElement(deleteIconProp) ? /* @__PURE__ */ import_react.cloneElement(deleteIconProp, {
		className: clsx(deleteIconProp.props.className, classes.deleteIcon),
		onClick: handleDeleteIconClick
	}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cancel_default, {
		className: classes.deleteIcon,
		onClick: handleDeleteIconClick
	});
	let avatar = null;
	if (avatarProp && /* @__PURE__ */ import_react.isValidElement(avatarProp)) avatar = /* @__PURE__ */ import_react.cloneElement(avatarProp, { className: clsx(classes.avatar, avatarProp.props.className) });
	let icon = null;
	if (iconProp && /* @__PURE__ */ import_react.isValidElement(iconProp)) icon = /* @__PURE__ */ import_react.cloneElement(iconProp, { className: clsx(classes.icon, iconProp.props.className) });
	if (avatar && icon) console.error("MUI: The Chip component can not handle the avatar and the icon prop at the same time. Pick one.");
	const externalForwardedProps = {
		slots,
		slotProps
	};
	const [RootSlot, rootProps] = useSlot("root", {
		elementType: ChipRoot,
		externalForwardedProps: {
			...externalForwardedProps,
			...buttonBaseProps
		},
		ownerState,
		shouldForwardComponentProp: true,
		ref: handleRef,
		className: clsx(classes.root, className),
		additionalProps: {
			disabled: clickable && disabled ? true : void 0,
			tabIndex: skipFocusWhenDisabled && disabled ? -1 : tabIndex,
			...moreProps
		},
		getSlotProps: (handlers) => ({
			...handlers,
			onClick: (event) => {
				handlers.onClick?.(event);
				onClick?.(event);
			},
			onKeyDown: (event) => {
				handlers.onKeyDown?.(event);
				handleKeyDown(event);
			},
			onKeyUp: (event) => {
				handlers.onKeyUp?.(event);
				handleKeyUp(event);
			}
		})
	});
	const [LabelSlot, labelProps] = useSlot("label", {
		elementType: ChipLabel,
		externalForwardedProps,
		ownerState,
		className: classes.label
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(RootSlot, {
		as: component,
		...rootProps,
		children: [
			avatar || icon,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LabelSlot, {
				...labelProps,
				children: label
			}),
			deleteIcon
		]
	});
});
Chip.propTypes = {
	avatar: import_prop_types.default.element,
	children: unsupportedProp_default,
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	clickable: import_prop_types.default.bool,
	color: import_prop_types.default.oneOfType([import_prop_types.default.oneOf([
		"default",
		"primary",
		"secondary",
		"error",
		"info",
		"success",
		"warning"
	]), import_prop_types.default.string]),
	component: import_prop_types.default.elementType,
	deleteIcon: import_prop_types.default.element,
	disabled: import_prop_types.default.bool,
	icon: import_prop_types.default.element,
	label: import_prop_types.default.node,
	nativeButton: import_prop_types.default.bool,
	onClick: import_prop_types.default.func,
	onDelete: import_prop_types.default.func,
	onKeyDown: import_prop_types.default.func,
	onKeyUp: import_prop_types.default.func,
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["medium", "small"]), import_prop_types.default.string]),
	skipFocusWhenDisabled: import_prop_types.default.bool,
	slotProps: import_prop_types.default.shape({
		label: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		label: import_prop_types.default.elementType,
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
	]),
	tabIndex: import_prop_types.default.number,
	variant: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["filled", "outlined"]), import_prop_types.default.string])
};
//#endregion
//#region frontend/node_modules/@mui/material/Autocomplete/Autocomplete.mjs
var _ClearIcon, _ArrowDropDownIcon;
var useUtilityClasses = (ownerState) => {
	const { classes, disablePortal, expanded, focused, fullWidth, hasClearIcon, hasPopupIcon, inputFocused, popupOpen, size } = ownerState;
	return composeClasses({
		root: [
			"root",
			expanded && "expanded",
			focused && "focused",
			fullWidth && "fullWidth",
			hasClearIcon && "hasClearIcon",
			hasPopupIcon && "hasPopupIcon"
		],
		inputRoot: ["inputRoot"],
		input: ["input", inputFocused && "inputFocused"],
		tag: ["tag", `tagSize${capitalize_default(size)}`],
		endAdornment: ["endAdornment"],
		clearIndicator: ["clearIndicator"],
		popupIndicator: ["popupIndicator", popupOpen && "popupIndicatorOpen"],
		popper: ["popper", disablePortal && "popperDisablePortal"],
		paper: ["paper"],
		listbox: ["listbox"],
		loading: ["loading"],
		noOptions: ["noOptions"],
		option: ["option"],
		groupLabel: ["groupLabel"],
		groupUl: ["groupUl"]
	}, getAutocompleteUtilityClass, classes);
};
var AutocompleteRoot = styled("div", {
	name: "MuiAutocomplete",
	slot: "Root",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		const { fullWidth, hasClearIcon, hasPopupIcon, inputFocused, size } = ownerState;
		return [
			{ [`& .${autocompleteClasses.tag}`]: styles.tag },
			{ [`& .${autocompleteClasses.tag}`]: styles[`tagSize${capitalize_default(size)}`] },
			{ [`& .${autocompleteClasses.inputRoot}`]: styles.inputRoot },
			{ [`& .${autocompleteClasses.input}`]: styles.input },
			{ [`& .${autocompleteClasses.input}`]: inputFocused && styles.inputFocused },
			styles.root,
			fullWidth && styles.fullWidth,
			hasPopupIcon && styles.hasPopupIcon,
			hasClearIcon && styles.hasClearIcon
		];
	}
})({
	[`&.${autocompleteClasses.focused} .${autocompleteClasses.clearIndicator}`]: { visibility: "visible" },
	"@media (pointer: fine)": { [`&:hover .${autocompleteClasses.clearIndicator}`]: { visibility: "visible" } },
	[`& .${autocompleteClasses.tag}`]: {
		margin: 3,
		maxWidth: "calc(100% - 6px)"
	},
	[`& .${autocompleteClasses.inputRoot}`]: {
		[`.${autocompleteClasses.hasPopupIcon}&, .${autocompleteClasses.hasClearIcon}&`]: { paddingRight: 30 },
		[`.${autocompleteClasses.hasPopupIcon}.${autocompleteClasses.hasClearIcon}&`]: { paddingRight: 56 },
		[`& .${autocompleteClasses.input}`]: {
			width: 0,
			minWidth: 30
		}
	},
	[`& .${inputClasses.root}`]: {
		paddingBottom: 1,
		"& .MuiInput-input": { padding: "4px 4px 4px 0px" }
	},
	[`& .${inputClasses.root}.${inputBaseClasses.sizeSmall}`]: { [`& .${inputClasses.input}`]: { padding: "2px 4px 3px 0" } },
	[`& .${outlinedInputClasses.root}`]: {
		padding: 9,
		[`.${autocompleteClasses.hasPopupIcon}&, .${autocompleteClasses.hasClearIcon}&`]: { paddingRight: 39 },
		[`.${autocompleteClasses.hasPopupIcon}.${autocompleteClasses.hasClearIcon}&`]: { paddingRight: 65 },
		[`& .${autocompleteClasses.input}`]: { padding: "7.5px 4px 7.5px 5px" },
		[`& .${autocompleteClasses.endAdornment}`]: { right: 9 }
	},
	[`& .${outlinedInputClasses.root}.${inputBaseClasses.sizeSmall}`]: {
		paddingTop: 6,
		paddingBottom: 6,
		paddingLeft: 6,
		[`& .${autocompleteClasses.input}`]: { padding: "2.5px 4px 2.5px 8px" }
	},
	[`& .${filledInputClasses.root}`]: {
		paddingTop: 19,
		paddingLeft: 8,
		[`.${autocompleteClasses.hasPopupIcon}&, .${autocompleteClasses.hasClearIcon}&`]: { paddingRight: 39 },
		[`.${autocompleteClasses.hasPopupIcon}.${autocompleteClasses.hasClearIcon}&`]: { paddingRight: 65 },
		[`& .${filledInputClasses.input}`]: { padding: "7px 4px" },
		[`& .${autocompleteClasses.endAdornment}`]: { right: 9 }
	},
	[`& .${filledInputClasses.root}.${inputBaseClasses.sizeSmall}`]: {
		paddingBottom: 1,
		[`& .${filledInputClasses.input}`]: { padding: "2.5px 4px" }
	},
	[`& .${inputBaseClasses.hiddenLabel}`]: { paddingTop: 8 },
	[`& .${filledInputClasses.root}.${inputBaseClasses.hiddenLabel}`]: {
		paddingTop: 0,
		paddingBottom: 0,
		[`& .${autocompleteClasses.input}`]: {
			paddingTop: 16,
			paddingBottom: 17
		}
	},
	[`& .${filledInputClasses.root}.${inputBaseClasses.hiddenLabel}.${inputBaseClasses.sizeSmall}`]: { [`& .${autocompleteClasses.input}`]: {
		paddingTop: 8,
		paddingBottom: 9
	} },
	[`& .${autocompleteClasses.input}`]: {
		flexGrow: 1,
		textOverflow: "ellipsis",
		opacity: 0
	},
	variants: [
		{
			props: { fullWidth: true },
			style: { width: "100%" }
		},
		{
			props: { size: "small" },
			style: { [`& .${autocompleteClasses.tag}`]: {
				margin: 2,
				maxWidth: "calc(100% - 4px)"
			} }
		},
		{
			props: { inputFocused: true },
			style: { [`& .${autocompleteClasses.input}`]: { opacity: 1 } }
		},
		{
			props: { multiple: true },
			style: { [`& .${autocompleteClasses.inputRoot}`]: { flexWrap: "wrap" } }
		}
	]
});
var AutocompleteEndAdornment = styled("div", {
	name: "MuiAutocomplete",
	slot: "EndAdornment"
})({
	position: "absolute",
	right: 0,
	top: "50%",
	transform: "translate(0, -50%)"
});
var AutocompleteClearIndicator = styled(IconButton, {
	name: "MuiAutocomplete",
	slot: "ClearIndicator"
})({
	marginRight: -2,
	padding: 4,
	visibility: "hidden"
});
var AutocompletePopupIndicator = styled(IconButton, {
	name: "MuiAutocomplete",
	slot: "PopupIndicator",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [styles.popupIndicator, ownerState.popupOpen && styles.popupIndicatorOpen];
	}
})({
	padding: 2,
	marginRight: -2,
	variants: [{
		props: { popupOpen: true },
		style: { transform: "rotate(180deg)" }
	}]
});
var AutocompletePopper = styled(Popper, {
	name: "MuiAutocomplete",
	slot: "Popper",
	overridesResolver: (props, styles) => {
		const { ownerState } = props;
		return [
			{ [`& .${autocompleteClasses.option}`]: styles.option },
			styles.popper,
			ownerState.disablePortal && styles.popperDisablePortal
		];
	}
})(memoTheme(({ theme }) => ({
	zIndex: (theme.vars || theme).zIndex.modal,
	variants: [{
		props: { disablePortal: true },
		style: { position: "absolute" }
	}]
})));
var AutocompletePaper = styled(Paper, {
	name: "MuiAutocomplete",
	slot: "Paper"
})(memoTheme(({ theme }) => ({
	...theme.typography.body1,
	overflow: "auto"
})));
var AutocompleteLoading = styled("div", {
	name: "MuiAutocomplete",
	slot: "Loading"
})(memoTheme(({ theme }) => ({
	color: (theme.vars || theme).palette.text.secondary,
	padding: "14px 16px"
})));
var AutocompleteNoOptions = styled("div", {
	name: "MuiAutocomplete",
	slot: "NoOptions"
})(memoTheme(({ theme }) => ({
	color: (theme.vars || theme).palette.text.secondary,
	padding: "14px 16px"
})));
var AutocompleteListbox = styled("ul", {
	name: "MuiAutocomplete",
	slot: "Listbox"
})(memoTheme(({ theme }) => ({
	listStyle: "none",
	margin: 0,
	padding: "8px 0",
	maxHeight: "40vh",
	overflow: "auto",
	isolation: "isolate",
	position: "relative",
	[`& .${autocompleteClasses.option}`]: {
		minHeight: 48,
		display: "flex",
		overflow: "hidden",
		justifyContent: "flex-start",
		alignItems: "center",
		cursor: "pointer",
		paddingTop: 6,
		boxSizing: "border-box",
		outline: "0",
		WebkitTapHighlightColor: "transparent",
		paddingBottom: 6,
		paddingLeft: 16,
		paddingRight: 16,
		[theme.breakpoints.up("sm")]: { minHeight: "auto" },
		[`&.${autocompleteClasses.focused}`]: {
			backgroundColor: (theme.vars || theme).palette.action.hover,
			"@media (hover: none)": { backgroundColor: "transparent" }
		},
		"&[aria-disabled=\"true\"]": {
			opacity: (theme.vars || theme).palette.action.disabledOpacity,
			pointerEvents: "none"
		},
		[`&.${autocompleteClasses.focusVisible}`]: { backgroundColor: (theme.vars || theme).palette.action.focus },
		"&[aria-selected=\"true\"]": {
			backgroundColor: theme.alpha((theme.vars || theme).palette.primary.main, (theme.vars || theme).palette.action.selectedOpacity),
			[`&.${autocompleteClasses.focused}`]: {
				backgroundColor: theme.alpha((theme.vars || theme).palette.primary.main, `${(theme.vars || theme).palette.action.selectedOpacity} + ${(theme.vars || theme).palette.action.hoverOpacity}`),
				"@media (hover: none)": { backgroundColor: (theme.vars || theme).palette.action.selected }
			},
			[`&.${autocompleteClasses.focusVisible}`]: { backgroundColor: theme.alpha((theme.vars || theme).palette.primary.main, `${(theme.vars || theme).palette.action.selectedOpacity} + ${(theme.vars || theme).palette.action.focusOpacity}`) }
		}
	}
})));
var AutocompleteGroupLabel = styled(ListSubheader, {
	name: "MuiAutocomplete",
	slot: "GroupLabel"
})(memoTheme(({ theme }) => ({
	backgroundColor: (theme.vars || theme).palette.background.paper,
	top: -8
})));
var AutocompleteGroupUl = styled("ul", {
	name: "MuiAutocomplete",
	slot: "GroupUl"
})({
	padding: 0,
	[`& .${autocompleteClasses.option}`]: { paddingLeft: 24 }
});
var Autocomplete = /* @__PURE__ */ import_react.forwardRef(function Autocomplete(inProps, ref) {
	const props = useDefaultProps({
		props: inProps,
		name: "MuiAutocomplete"
	});
	const { autoComplete = false, autoHighlight = false, autoSelect = false, blurOnSelect = false, className, clearIcon = _ClearIcon || (_ClearIcon = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Close_default, { fontSize: "small" })), clearOnBlur = !props.freeSolo, clearOnEscape = false, clearText = "Clear", closeText = "Close", defaultValue = props.multiple ? [] : null, disableClearable = false, disableCloseOnSelect = false, disabled = false, disabledItemsFocusable = false, disableListWrap = false, disablePortal = false, filterOptions, filterSelectedOptions = false, forcePopupIcon = "auto", freeSolo = false, fullWidth = false, getLimitTagsText = (more) => `+${more}`, getOptionDisabled, getOptionKey, getOptionLabel: getOptionLabelProp, isOptionEqualToValue, groupBy, handleHomeEndKeys = !props.freeSolo, id: idProp, includeInputInList = false, inputValue: inputValueProp, limitTags = -1, loading = false, loadingText = "Loading…", multiple = false, noOptionsText = "No options", onChange, onClose, onHighlightChange, onInputChange, onOpen, open, openOnFocus = false, openText = "Open", options, popupIcon = _ArrowDropDownIcon || (_ArrowDropDownIcon = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowDropDown_default, {})), readOnly = false, renderGroup: renderGroupProp, renderInput, renderOption: renderOptionProp, renderValue, resetHighlightOnMouseLeave = false, selectOnFocus = !props.freeSolo, size = "medium", slots = {}, slotProps = {}, value: valueProp, ...other } = props;
	const { getRootProps, getInputProps, getInputLabelProps, getPopupIndicatorProps, getClearProps, getItemProps, getListboxProps, getOptionProps, value, dirty, expanded, id, popupOpen, focused, focusedItem, anchorEl, setAnchorEl, inputValue, groupedOptions } = useAutocomplete({
		...props,
		componentName: "Autocomplete"
	});
	const forceRenderOnResize = useForcedRerendering();
	import_react.useEffect(() => {
		if (!popupOpen || !anchorEl || typeof ResizeObserver === "undefined") return;
		let lastWidth = anchorEl.clientWidth;
		const observer = new ResizeObserver(() => {
			const newWidth = anchorEl.clientWidth;
			if (lastWidth !== newWidth) {
				lastWidth = newWidth;
				forceRenderOnResize();
			}
		});
		observer.observe(anchorEl);
		return () => {
			observer.disconnect();
		};
	}, [
		popupOpen,
		anchorEl,
		forceRenderOnResize
	]);
	const previousGroupedOptionsRef = import_react.useRef([]);
	const prevPopupOpenRef = import_react.useRef(false);
	const renderedOptions = popupOpen ? groupedOptions : previousGroupedOptionsRef.current;
	useEnhancedEffect(() => {
		if (popupOpen && !prevPopupOpenRef.current) previousGroupedOptionsRef.current = [];
		prevPopupOpenRef.current = popupOpen;
		if (popupOpen && groupedOptions.length > 0) previousGroupedOptionsRef.current = groupedOptions;
	}, [popupOpen, groupedOptions]);
	const hasClearIcon = !disableClearable && !disabled && dirty && !readOnly;
	const hasPopupIcon = (!freeSolo || forcePopupIcon === true) && forcePopupIcon !== false;
	const { onMouseDown: handleInputMouseDown } = getInputProps();
	const defaultGetOptionLabel = (option) => option.label ?? option;
	const getOptionLabel = getOptionLabelProp || defaultGetOptionLabel;
	const ownerState = {
		...props,
		disablePortal,
		expanded,
		focused,
		fullWidth,
		getOptionLabel,
		hasClearIcon,
		hasPopupIcon,
		inputFocused: focusedItem === -1,
		popupOpen,
		size
	};
	const classes = useUtilityClasses(ownerState);
	const externalForwardedProps = {
		slots,
		slotProps
	};
	const [RootSlot, rootProps] = useSlot("root", {
		ref,
		className: [classes.root, className],
		elementType: AutocompleteRoot,
		externalForwardedProps: {
			...externalForwardedProps,
			...other
		},
		getSlotProps: getRootProps,
		ownerState
	});
	const [ListboxSlot, listboxProps] = useSlot("listbox", {
		elementType: AutocompleteListbox,
		externalForwardedProps,
		ownerState,
		className: classes.listbox,
		getSlotProps: getListboxProps
	});
	const [PaperSlot, paperProps] = useSlot("paper", {
		elementType: Paper,
		externalForwardedProps,
		ownerState,
		className: classes.paper
	});
	const [PopperSlot, popperProps] = useSlot("popper", {
		elementType: Popper,
		externalForwardedProps,
		ownerState,
		className: classes.popper,
		additionalProps: {
			disablePortal,
			style: {
				width: anchorEl ? anchorEl.clientWidth : null,
				pointerEvents: popupOpen ? void 0 : "none"
			},
			role: "presentation",
			anchorEl,
			open: popupOpen
		}
	});
	const hasPopupContent = renderedOptions.length > 0 || loading || !freeSolo || popperProps.keepMounted === true;
	const [ClearIndicatorSlot, clearIndicatorProps] = useSlot("clearIndicator", {
		elementType: AutocompleteClearIndicator,
		externalForwardedProps,
		ownerState,
		className: classes.clearIndicator,
		shouldForwardComponentProp: true,
		additionalProps: {
			...getClearProps(),
			"aria-label": clearText,
			title: clearText
		}
	});
	const [PopupIndicatorSlot, popupIndicatorProps] = useSlot("popupIndicator", {
		elementType: AutocompletePopupIndicator,
		externalForwardedProps,
		ownerState,
		className: classes.popupIndicator,
		shouldForwardComponentProp: true,
		additionalProps: {
			...getPopupIndicatorProps(),
			disabled,
			"aria-label": popupOpen ? closeText : openText,
			title: popupOpen ? closeText : openText
		}
	});
	let startAdornment;
	const getCustomizedItemProps = (params) => ({
		className: classes.tag,
		disabled,
		...getItemProps(params)
	});
	if (multiple) {
		if (value.length > 0) if (renderValue) startAdornment = renderValue(value, getCustomizedItemProps, ownerState);
		else startAdornment = value.map((option, index) => {
			const { key, ...customItemProps } = getCustomizedItemProps({ index });
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
				label: getOptionLabel(option),
				size,
				...customItemProps,
				...externalForwardedProps.slotProps.chip
			}, key);
		});
	} else if (renderValue && value != null) startAdornment = renderValue(value, getCustomizedItemProps, ownerState);
	if (limitTags > -1 && Array.isArray(startAdornment)) {
		const more = startAdornment.length - limitTags;
		if (!focused && more > 0) {
			startAdornment = startAdornment.splice(0, limitTags);
			startAdornment.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: classes.tag,
				children: getLimitTagsText(more)
			}, startAdornment.length));
		}
	}
	const defaultRenderGroup = (params) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AutocompleteGroupLabel, {
		className: classes.groupLabel,
		ownerState,
		component: "div",
		children: params.group
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AutocompleteGroupUl, {
		className: classes.groupUl,
		ownerState,
		children: params.children
	})] }, params.key);
	const renderGroup = renderGroupProp || defaultRenderGroup;
	const defaultRenderOption = (props2, option) => {
		const { key, ...otherProps } = props2;
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
			...otherProps,
			children: getOptionLabel(option)
		}, key);
	};
	const renderOption = renderOptionProp || defaultRenderOption;
	const renderListOption = (option, index) => {
		const optionProps = getOptionProps({
			option,
			index
		});
		return renderOption({
			...optionProps,
			className: classes.option
		}, option, {
			selected: optionProps["aria-selected"],
			index,
			inputValue
		}, ownerState);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RootSlot, {
		...rootProps,
		children: renderInput({
			id,
			disabled,
			fullWidth: props.fullWidth ?? true,
			size: size === "small" ? "small" : void 0,
			slotProps: {
				inputLabel: getInputLabelProps(),
				input: {
					ref: setAnchorEl,
					className: classes.inputRoot,
					startAdornment,
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) handleInputMouseDown(event);
					},
					...(hasClearIcon || hasPopupIcon) && { endAdornment: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AutocompleteEndAdornment, {
						className: classes.endAdornment,
						ownerState,
						children: [hasClearIcon ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClearIndicatorSlot, {
							...clearIndicatorProps,
							children: clearIcon
						}) : null, hasPopupIcon ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopupIndicatorSlot, {
							...popupIndicatorProps,
							children: popupIcon
						}) : null]
					}) }
				},
				htmlInput: {
					className: classes.input,
					disabled,
					readOnly,
					...getInputProps()
				}
			}
		})
	}), anchorEl && hasPopupContent ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AutocompletePopper, {
		as: PopperSlot,
		...popperProps,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AutocompletePaper, {
			as: PaperSlot,
			...paperProps,
			children: [
				loading && renderedOptions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AutocompleteLoading, {
					className: classes.loading,
					ownerState,
					children: loadingText
				}) : null,
				renderedOptions.length === 0 && !freeSolo && !loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AutocompleteNoOptions, {
					className: classes.noOptions,
					ownerState,
					role: "presentation",
					onMouseDown: (event) => {
						event.preventDefault();
					},
					children: noOptionsText
				}) : null,
				renderedOptions.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListboxSlot, {
					...listboxProps,
					children: renderedOptions.map((option, index) => {
						if (groupBy) return renderGroup({
							key: option.key,
							group: option.group,
							children: option.options.map((option2, index2) => renderListOption(option2, option.index + index2))
						});
						return renderListOption(option, index);
					})
				}) : null
			]
		})
	}) : null] });
});
Autocomplete.propTypes = {
	autoComplete: import_prop_types.default.bool,
	autoHighlight: import_prop_types.default.bool,
	autoSelect: import_prop_types.default.bool,
	blurOnSelect: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["mouse", "touch"]), import_prop_types.default.bool]),
	classes: import_prop_types.default.object,
	className: import_prop_types.default.string,
	clearIcon: import_prop_types.default.node,
	clearOnBlur: import_prop_types.default.bool,
	clearOnEscape: import_prop_types.default.bool,
	clearText: import_prop_types.default.string,
	closeText: import_prop_types.default.string,
	defaultValue: chainPropTypes(import_prop_types.default.any, (props) => {
		if (props.multiple && props.defaultValue !== void 0 && !Array.isArray(props.defaultValue)) return new Error(["MUI: The Autocomplete expects the `defaultValue` prop to be an array when `multiple={true}` or undefined.", `However, ${props.defaultValue} was provided.`].join("\n"));
		return null;
	}),
	disableClearable: import_prop_types.default.bool,
	disableCloseOnSelect: import_prop_types.default.bool,
	disabled: import_prop_types.default.bool,
	disabledItemsFocusable: import_prop_types.default.bool,
	disableListWrap: import_prop_types.default.bool,
	disablePortal: import_prop_types.default.bool,
	filterOptions: import_prop_types.default.func,
	filterSelectedOptions: import_prop_types.default.bool,
	forcePopupIcon: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["auto"]), import_prop_types.default.bool]),
	freeSolo: import_prop_types.default.bool,
	fullWidth: import_prop_types.default.bool,
	getLimitTagsText: import_prop_types.default.func,
	getOptionDisabled: import_prop_types.default.func,
	getOptionKey: import_prop_types.default.func,
	getOptionLabel: import_prop_types.default.func,
	groupBy: import_prop_types.default.func,
	handleHomeEndKeys: import_prop_types.default.bool,
	id: import_prop_types.default.string,
	includeInputInList: import_prop_types.default.bool,
	inputValue: import_prop_types.default.string,
	isOptionEqualToValue: import_prop_types.default.func,
	limitTags: integerPropType,
	loading: import_prop_types.default.bool,
	loadingText: import_prop_types.default.node,
	multiple: import_prop_types.default.bool,
	noOptionsText: import_prop_types.default.node,
	onChange: import_prop_types.default.func,
	onClose: import_prop_types.default.func,
	onHighlightChange: import_prop_types.default.func,
	onInputChange: import_prop_types.default.func,
	onKeyDown: import_prop_types.default.func,
	onOpen: import_prop_types.default.func,
	open: import_prop_types.default.bool,
	openOnFocus: import_prop_types.default.bool,
	openText: import_prop_types.default.string,
	options: import_prop_types.default.array.isRequired,
	popupIcon: import_prop_types.default.node,
	readOnly: import_prop_types.default.bool,
	renderGroup: import_prop_types.default.func,
	renderInput: import_prop_types.default.func.isRequired,
	renderOption: import_prop_types.default.func,
	renderValue: import_prop_types.default.func,
	resetHighlightOnMouseLeave: import_prop_types.default.bool,
	selectOnFocus: import_prop_types.default.bool,
	size: import_prop_types.default.oneOfType([import_prop_types.default.oneOf(["small", "medium"]), import_prop_types.default.string]),
	slotProps: import_prop_types.default.shape({
		chip: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		clearIndicator: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		listbox: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		paper: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		popper: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		popupIndicator: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object]),
		root: import_prop_types.default.oneOfType([import_prop_types.default.func, import_prop_types.default.object])
	}),
	slots: import_prop_types.default.shape({
		clearIndicator: import_prop_types.default.elementType,
		listbox: import_prop_types.default.elementType,
		paper: import_prop_types.default.elementType,
		popper: import_prop_types.default.elementType,
		popupIndicator: import_prop_types.default.elementType,
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
	]),
	value: chainPropTypes(import_prop_types.default.any, (props) => {
		if (props.multiple && props.value !== void 0 && !Array.isArray(props.value)) return new Error(["MUI: The Autocomplete expects the `value` prop to be an array when `multiple={true}` or undefined.", `However, ${props.value} was provided.`].join("\n"));
		return null;
	})
};
//#endregion
export { isFocusVisible as C, touchRippleClasses as S, getAutocompleteUtilityClass as T, iconButtonClasses as _, ListSubheader as a, getButtonBaseUtilityClass as b, Popper as c, createFilterOptions as d, useAutocomplete as f, getIconButtonUtilityClass as g, IconButton as h, getChipUtilityClass as i, getPopperUtilityClass as l, Close_default as m, Chip as n, getListSubheaderUtilityClass as o, usePreviousProps as p, chipClasses as r, listSubheaderClasses as s, Autocomplete as t, popperClasses as u, ButtonBase as v, autocompleteClasses as w, getTouchRippleUtilityClass as x, buttonBaseClasses as y };

//# sourceMappingURL=Autocomplete-BgdA4vLj.js.map