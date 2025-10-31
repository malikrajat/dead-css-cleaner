import React from 'react';
import './comprehensive-test.css';

const MixedComponent: React.FC = () => {
    return (
        <div id="react-container">
            <button className="react-button react-primary shared-class">
                React Button
            </button>
        </div>
    );
};

export default MixedComponent;