"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
require("./styles.css");
const Component = ({ isActive }) => {
    return (<div>
            <h1 id="header">Welcome</h1>
            <button className="button primary">
                Click me
            </button>
            <div className={`container ${isActive ? 'active' : ''}`}>
                Content here
            </div>
        </div>);
};
exports.default = Component;
//# sourceMappingURL=Component.js.map