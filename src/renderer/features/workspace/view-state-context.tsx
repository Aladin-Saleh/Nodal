import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  INITIAL_VIEW_STATE,
  viewReducer,
  type ViewAction,
  type ViewState,
} from './view-state';

const ViewStateContext = createContext<ViewState | null>(null);
const ViewDispatchContext = createContext<Dispatch<ViewAction> | null>(null);

/** État de la vue partagé par l'arborescence, le graphe et les panneaux. */
export function ViewStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(viewReducer, INITIAL_VIEW_STATE);
  return (
    <ViewStateContext.Provider value={state}>
      <ViewDispatchContext.Provider value={dispatch}>
        {children}
      </ViewDispatchContext.Provider>
    </ViewStateContext.Provider>
  );
}

export function useViewState(): ViewState {
  const state = useContext(ViewStateContext);
  if (!state) throw new Error('useViewState hors de ViewStateProvider');
  return state;
}

export function useViewDispatch(): Dispatch<ViewAction> {
  const dispatch = useContext(ViewDispatchContext);
  if (!dispatch) throw new Error('useViewDispatch hors de ViewStateProvider');
  return dispatch;
}
