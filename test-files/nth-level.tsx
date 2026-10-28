import clsx from 'clsx';
import './nth-level.scss';

interface CardProps {
    isOpen: boolean;
    isCompact: boolean;
}

export const Card = ({ isOpen, isCompact }: CardProps) => (
    <article className={clsx('card', isCompact && 'card--compact')}>
        <header className="card__header">
            <h2 className={clsx('card__title', isOpen ? 'card__title--open' : 'card__title--closed')}>
                Title
                <i className="card__icon" />
            </h2>
        </header>
        <div className="card__body">
            <p className="card__text">Body</p>
        </div>
    </article>
);
