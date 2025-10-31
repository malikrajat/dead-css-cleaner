import React from 'react';
import './styles.css';

interface Props {
    isActive: boolean;
}

const Component: React.FC<Props> = ({ isActive }) => {
    return (
        <div>
            <h1 id="header">Welcome</h1>
            <button className="button primary">
                Click me
            </button>
            <div className={`container ${isActive ? 'active' : ''}`}>
                Content here
            </div>
        </div>
    );
};

export default Component;