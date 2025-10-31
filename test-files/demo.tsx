import React from 'react';
import './demo-styles.css';

const DemoComponent: React.FC = () => {
    return (
        <div id="used-id">
            <h1 className="used-class">Demo Component</h1>
            <p className="another-used-class">
                This component uses some CSS classes but not all of them.
                The unused ones should show up with detailed tooltips!
            </p>
        </div>
    );
};

export default DemoComponent;